import {
  BOARD_MUTATION_EVENT_TYPES,
  type BoardInvalidationType,
} from "./board-events.ts";

const BOARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 30_000;

const boardInvalidationTypes = new Set<string>([
  ...BOARD_MUTATION_EVENT_TYPES,
  "resync",
]);

export type RawSseEvent = {
  event: string;
  data: string;
  id: string | null;
};

export type BoardSseEvent =
  | {
    event: "board.ready";
    boardId: string;
    revision: string;
  }
  | {
    event: "board.invalidate";
    id: string;
    boardId: string;
    revision: string;
    type: BoardInvalidationType;
  };

export class SseProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SseProtocolError";
  }
}

/**
 * Incrementally parses SSE fields. The returned id belongs to the current SSE
 * block rather than inheriting the previous block's id, so invalidations can
 * require an explicit revision id before the client acknowledges them.
 */
export class SseEventParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];
  private eventId: string | null = null;
  private hasEventFields = false;
  private finished = false;

  push(chunk: string): RawSseEvent[] {
    if (this.finished) {
      throw new Error("Cannot push to a finished SSE parser");
    }

    this.buffer += chunk;
    const events: RawSseEvent[] = [];

    while (true) {
      const delimiter = this.findLineDelimiter();
      if (delimiter === null) {
        break;
      }

      const line = this.buffer.slice(0, delimiter.index);
      this.buffer = this.buffer.slice(delimiter.index + delimiter.length);
      this.processLine(line, events);
    }

    return events;
  }

  finish(): RawSseEvent[] {
    if (this.finished) {
      return [];
    }
    this.finished = true;
    // An EOF before the empty-line terminator is a transport interruption, not
    // a complete event. Discard it so reconnect resumes from the last full ID.
    this.buffer = "";
    this.eventName = "";
    this.dataLines = [];
    this.eventId = null;
    this.hasEventFields = false;
    return [];
  }

  private findLineDelimiter(): { index: number; length: number } | null {
    for (let index = 0; index < this.buffer.length; index += 1) {
      const character = this.buffer[index];
      if (character === "\n") {
        return { index, length: 1 };
      }
      if (character === "\r") {
        if (index === this.buffer.length - 1) {
          return null;
        }
        return {
          index,
          length: this.buffer[index + 1] === "\n" ? 2 : 1,
        };
      }
    }
    return null;
  }

  private processLine(line: string, events: RawSseEvent[]): void {
    if (line === "") {
      const event = this.dispatchEvent();
      if (event) {
        events.push(event);
      }
      return;
    }

    if (line.startsWith(":")) {
      return;
    }

    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    switch (field) {
      case "event":
        this.eventName = value;
        this.hasEventFields = true;
        break;
      case "data":
        this.dataLines.push(value);
        this.hasEventFields = true;
        break;
      case "id":
        if (!value.includes("\0")) {
          this.eventId = value;
          this.hasEventFields = true;
        }
        break;
      default:
        break;
    }
  }

  private dispatchEvent(): RawSseEvent | null {
    if (!this.hasEventFields) {
      return null;
    }

    const event: RawSseEvent = {
      event: this.eventName || "message",
      data: this.dataLines.join("\n"),
      id: this.eventId,
    };
    this.eventName = "";
    this.dataLines = [];
    this.eventId = null;
    this.hasEventFields = false;
    return event;
  }
}

const protocolError = (message: string): never => {
  throw new SseProtocolError(message);
};

const hasExactKeys = (
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean => {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
};

const parseJsonObject = (data: string): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return protocolError("SSE event data must be valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return protocolError("SSE event data must be a JSON object");
  }
  return parsed as Record<string, unknown>;
};

const requireExpectedBoardId = (
  value: unknown,
  expectedBoardId: string,
): string => {
  if (!BOARD_ID_PATTERN.test(expectedBoardId)) {
    return protocolError("Expected board id must be a canonical UUID v4");
  }
  if (
    typeof value !== "string"
    || !BOARD_ID_PATTERN.test(value)
    || value !== expectedBoardId
  ) {
    return protocolError("SSE event belongs to a different board");
  }
  return value;
};

const requireRevision = (value: unknown): string => {
  if (
    typeof value !== "string"
    || !REVISION_PATTERN.test(value)
    || value.length > 19
    || BigInt(value) > MAX_POSTGRES_BIGINT
  ) {
    return protocolError("SSE revision must be a canonical PostgreSQL bigint");
  }
  return value;
};

export const parseBoardSseEvent = (
  raw: RawSseEvent,
  expectedBoardId: string,
): BoardSseEvent => {
  if (
    !raw
    || typeof raw !== "object"
    || typeof raw.event !== "string"
    || typeof raw.data !== "string"
    || (raw.id !== null && typeof raw.id !== "string")
  ) {
    return protocolError("Malformed raw SSE event");
  }

  const data = parseJsonObject(raw.data);
  if (raw.event === "board.ready") {
    if (raw.id !== null) {
      return protocolError("board.ready must not include an event id");
    }
    if (!hasExactKeys(data, ["boardId", "revision"])) {
      return protocolError("board.ready data has an invalid shape");
    }

    return {
      event: "board.ready",
      boardId: requireExpectedBoardId(data.boardId, expectedBoardId),
      revision: requireRevision(data.revision),
    };
  }

  if (raw.event === "board.invalidate") {
    if (!hasExactKeys(data, ["boardId", "revision", "type"])) {
      return protocolError("board.invalidate data has an invalid shape");
    }
    const revision = requireRevision(data.revision);
    if (raw.id !== revision) {
      return protocolError("board.invalidate id must equal its revision");
    }
    if (typeof data.type !== "string" || !boardInvalidationTypes.has(data.type)) {
      return protocolError("board.invalidate type is not in the event registry");
    }

    return {
      event: "board.invalidate",
      id: raw.id,
      boardId: requireExpectedBoardId(data.boardId, expectedBoardId),
      revision,
      type: data.type as BoardInvalidationType,
    };
  }

  return protocolError(`Unsupported SSE event: ${raw.event}`);
};

/** Returns a deterministic zero-based reconnect delay: 1s, 2s, 4s, ... 30s. */
export const getReconnectDelayMs = (attempt: number): number => {
  if (!Number.isSafeInteger(attempt) || attempt < 0) {
    throw new RangeError("Reconnect attempt must be a non-negative safe integer");
  }
  if (attempt >= 5) {
    return RECONNECT_MAX_DELAY_MS;
  }
  return Math.min(
    RECONNECT_MAX_DELAY_MS,
    RECONNECT_BASE_DELAY_MS * (2 ** attempt),
  );
};

import type {
  BoardInvalidationType,
  BoardMutationEvent,
} from "./board-events.ts";

const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;

export const parseLastEventId = (value: string | null): bigint | null => {
  if (value === null) {
    return null;
  }
  if (
    !REVISION_PATTERN.test(value)
    || value.length > 19
    || BigInt(value) > MAX_POSTGRES_BIGINT
  ) {
    throw new RangeError("Last-Event-ID must be a canonical non-negative revision");
  }
  return BigInt(value);
};

export const compareRevisions = (left: string, right: string): number => {
  const leftRevision = parseLastEventId(left);
  const rightRevision = parseLastEventId(right);
  if (leftRevision === null || rightRevision === null) {
    throw new RangeError("Revisions are required");
  }
  return leftRevision < rightRevision ? -1 : leftRevision > rightRevision ? 1 : 0;
};

export const formatBoardReadyEvent = (
  boardId: string,
  revision: string,
): string => [
  "event: board.ready",
  `data: ${JSON.stringify({ boardId, revision })}`,
  "",
  "",
].join("\n");

export const formatBoardInvalidationEvent = ({
  boardId,
  revision,
  type,
}: {
  boardId: string;
  revision: string;
  type: BoardInvalidationType;
}): string => [
  `id: ${revision}`,
  "event: board.invalidate",
  `data: ${JSON.stringify({ boardId, revision, type })}`,
  "",
  "",
].join("\n");

export const formatMutationInvalidationEvent = (
  event: BoardMutationEvent,
): string => formatBoardInvalidationEvent(event);

export const formatHeartbeat = (): string => ": heartbeat\n\n";

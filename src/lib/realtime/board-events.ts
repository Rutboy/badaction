export const BOARD_EVENT_CHANNEL = "badaction_board_events";

export const BOARD_MUTATION_EVENT_TYPES = [
  "board.updated",
  "column.created",
  "column.updated",
  "column.moved",
  "column.deleted",
  "card.created",
  "card.updated",
  "card.moved",
  "card.deleted",
  "vote.updated",
  "votes.reset",
  "group.created",
  "group.updated",
  "group.moved",
  "group.deleted",
  "action.created",
  "action.updated",
  "action.moved",
  "action.deleted",
] as const;

export type BoardMutationEventType = typeof BOARD_MUTATION_EVENT_TYPES[number];
export type BoardInvalidationType = BoardMutationEventType | "resync";

export type BoardMutationEvent = {
  boardId: string;
  revision: string;
  type: BoardMutationEventType;
};

const BOARD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REVISION_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_POSTGRES_BIGINT = 9_223_372_036_854_775_807n;
const eventTypes = new Set<string>(BOARD_MUTATION_EVENT_TYPES);

export const serializeBoardMutationEvent = (
  event: BoardMutationEvent,
): string => JSON.stringify(event);

export const parseBoardMutationEvent = (
  payload: string,
): BoardMutationEvent | null => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const value = parsed as Record<string, unknown>;
    if (
      Object.keys(value).length !== 3
      || typeof value.boardId !== "string"
      || !BOARD_ID_PATTERN.test(value.boardId)
      || typeof value.revision !== "string"
      || !REVISION_PATTERN.test(value.revision)
      || value.revision.length > 19
      || BigInt(value.revision) > MAX_POSTGRES_BIGINT
      || typeof value.type !== "string"
      || !eventTypes.has(value.type)
    ) {
      return null;
    }

    return value as BoardMutationEvent;
  } catch {
    return null;
  }
};

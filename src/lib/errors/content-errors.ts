import { ApiError } from "./api-error-base.ts";

export type ContentErrorCode =
  | "INVALID_CURSOR"
  | "BOARD_OWNER_REQUIRED"
  | "CARD_OWNER_REQUIRED"
  | "BOARD_NOT_FOUND"
  | "COLUMN_NOT_FOUND"
  | "CARD_NOT_FOUND"
  | "GROUP_NOT_FOUND"
  | "ACTION_ITEM_NOT_FOUND"
  | "STALE_BOARD_REVISION"
  | "BOARD_READ_ONLY"
  | "CARDS_DISABLED"
  | "VOTING_DISABLED"
  | "VOTE_LIMIT_CONFLICT"
  | "VOTE_MOVE_CONFLICT"
  | "CARD_GROUPED"
  | "COLUMN_NOT_EMPTY"
  | "LAST_COLUMN_DELETE_FORBIDDEN"
  | "BOARD_CARD_LIMIT_REACHED"
  | "BOARD_COLUMN_LIMIT_REACHED"
  | "BOARD_ACTION_ITEM_LIMIT_REACHED"
  | "COLUMN_VOTE_LIMIT_REACHED"
  | "BOARD_EXPORT_LIMIT_EXCEEDED";

type ContentErrorStatus = 400 | 403 | 404 | 409 | 422;
type SafeDetails = Record<string, unknown> | undefined;

export class ContentApiError<
  Code extends ContentErrorCode,
  Details extends SafeDetails = undefined,
> extends ApiError {
  public override code: Code;
  public override details: Details;

  constructor(
    status: ContentErrorStatus,
    code: Code,
    message: string,
    details: Details,
  ) {
    super(status, code, message, details);
    this.code = code;
    this.details = details;
  }
}

const createContentError = <
  Code extends ContentErrorCode,
  Details extends SafeDetails = undefined,
>(
  status: ContentErrorStatus,
  code: Code,
  message: string,
  details?: Details,
) => new ContentApiError(status, code, message, details as Details);

export type BoardExportLimitDetails =
  | { cardLimit: number; voteLimit?: number }
  | { cardLimit?: number; voteLimit: number };

export const contentErrors = {
  invalidCursor: () =>
    createContentError(400, "INVALID_CURSOR", "The cursor is invalid or out of date."),

  boardOwnerRequired: () =>
    createContentError(
      403,
      "BOARD_OWNER_REQUIRED",
      "Only the board owner can perform this action.",
    ),

  cardOwnerRequired: () =>
    createContentError(
      403,
      "CARD_OWNER_REQUIRED",
      "You can only change cards created with your current access.",
    ),

  boardNotFound: () =>
    createContentError(404, "BOARD_NOT_FOUND", "Board not found."),

  columnNotFound: () =>
    createContentError(404, "COLUMN_NOT_FOUND", "Column not found."),

  cardNotFound: () =>
    createContentError(404, "CARD_NOT_FOUND", "Card not found."),

  groupNotFound: () =>
    createContentError(404, "GROUP_NOT_FOUND", "Group not found."),

  actionItemNotFound: () =>
    createContentError(404, "ACTION_ITEM_NOT_FOUND", "Action item not found."),

  staleBoardRevision: (currentRevision: string) =>
    createContentError(
      409,
      "STALE_BOARD_REVISION",
      "The board changed. Refresh it and try again.",
      { currentRevision },
    ),

  boardReadOnly: () =>
    createContentError(
      409,
      "BOARD_READ_ONLY",
      "The board is read-only.",
    ),

  cardsDisabled: () =>
    createContentError(409, "CARDS_DISABLED", "Cards are disabled on this board."),

  votingDisabled: () =>
    createContentError(409, "VOTING_DISABLED", "Voting is disabled on this board."),

  voteLimitConflict: (columnId: string, requestedLimit: number) =>
    createContentError(
      409,
      "VOTE_LIMIT_CONFLICT",
      "The new limit is below the number of votes already used.",
      { columnId, requestedLimit },
    ),

  voteMoveConflict: (targetColumnId: string) =>
    createContentError(
      409,
      "VOTE_MOVE_CONFLICT",
      "Moving this item would exceed the target column's vote limit.",
      { targetColumnId },
    ),

  cardGrouped: () =>
    createContentError(
      409,
      "CARD_GROUPED",
      "Ungroup the card before moving it on its own.",
    ),

  columnNotEmpty: () =>
    createContentError(
      409,
      "COLUMN_NOT_EMPTY",
      "The column contains cards. Choose how to handle them.",
    ),

  lastColumnDeleteForbidden: () =>
    createContentError(
      409,
      "LAST_COLUMN_DELETE_FORBIDDEN",
      "The final board column cannot be deleted.",
    ),

  boardCardLimitReached: (limit: number) =>
    createContentError(
      422,
      "BOARD_CARD_LIMIT_REACHED",
      "This board has reached its card limit.",
      { limit },
    ),

  boardColumnLimitReached: () =>
    createContentError(
      422,
      "BOARD_COLUMN_LIMIT_REACHED",
      "This board has reached its column limit.",
      { limit: 10 },
    ),

  boardActionItemLimitReached: () =>
    createContentError(
      422,
      "BOARD_ACTION_ITEM_LIMIT_REACHED",
      "This board has reached its action item limit.",
      { limit: 200 },
    ),

  columnVoteLimitReached: (columnId: string, limit: number) =>
    createContentError(
      422,
      "COLUMN_VOTE_LIMIT_REACHED",
      "No votes remain in this column.",
      { columnId, limit },
    ),

  boardExportLimitExceeded: (limits: BoardExportLimitDetails) => {
    const details: Record<string, number> = {};
    if (limits.cardLimit !== undefined) {
      details.cardLimit = limits.cardLimit;
    }
    if (limits.voteLimit !== undefined) {
      details.voteLimit = limits.voteLimit;
    }

    return createContentError(
      422,
      "BOARD_EXPORT_LIMIT_EXCEEDED",
      "The board is too large to export safely.",
      details,
    );
  },
} as const;

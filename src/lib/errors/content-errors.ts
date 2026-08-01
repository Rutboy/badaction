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
    createContentError(400, "INVALID_CURSOR", "Некорректный или устаревший cursor."),

  boardOwnerRequired: () =>
    createContentError(
      403,
      "BOARD_OWNER_REQUIRED",
      "Операция доступна только владельцу доски.",
    ),

  cardOwnerRequired: () =>
    createContentError(
      403,
      "CARD_OWNER_REQUIRED",
      "Можно изменять только карточки, созданные текущим участником.",
    ),

  boardNotFound: () =>
    createContentError(404, "BOARD_NOT_FOUND", "Доска не найдена."),

  columnNotFound: () =>
    createContentError(404, "COLUMN_NOT_FOUND", "Колонка не найдена."),

  cardNotFound: () =>
    createContentError(404, "CARD_NOT_FOUND", "Карточка не найдена."),

  groupNotFound: () =>
    createContentError(404, "GROUP_NOT_FOUND", "Группа не найдена."),

  actionItemNotFound: () =>
    createContentError(404, "ACTION_ITEM_NOT_FOUND", "Action item не найден."),

  staleBoardRevision: (currentRevision: string) =>
    createContentError(
      409,
      "STALE_BOARD_REVISION",
      "Состояние доски изменилось. Обновите данные и повторите действие.",
      { currentRevision },
    ),

  boardReadOnly: () =>
    createContentError(
      409,
      "BOARD_READ_ONLY",
      "Доска находится в режиме только для чтения.",
    ),

  cardsDisabled: () =>
    createContentError(409, "CARDS_DISABLED", "Работа с карточками отключена."),

  votingDisabled: () =>
    createContentError(409, "VOTING_DISABLED", "Голосование отключено."),

  voteLimitConflict: (columnId: string, requestedLimit: number) =>
    createContentError(
      409,
      "VOTE_LIMIT_CONFLICT",
      "Новый лимит меньше уже использованного количества голосов.",
      { columnId, requestedLimit },
    ),

  voteMoveConflict: (targetColumnId: string) =>
    createContentError(
      409,
      "VOTE_MOVE_CONFLICT",
      "Перемещение превысит лимит голосов целевой колонки.",
      { targetColumnId },
    ),

  cardGrouped: () =>
    createContentError(
      409,
      "CARD_GROUPED",
      "Сначала разъедините группу, чтобы переместить эту карточку.",
    ),

  columnNotEmpty: () =>
    createContentError(
      409,
      "COLUMN_NOT_EMPTY",
      "Колонка содержит карточки. Выберите явную стратегию удаления.",
    ),

  lastColumnDeleteForbidden: () =>
    createContentError(
      409,
      "LAST_COLUMN_DELETE_FORBIDDEN",
      "Нельзя удалить последнюю колонку доски.",
    ),

  boardCardLimitReached: (limit: number) =>
    createContentError(
      422,
      "BOARD_CARD_LIMIT_REACHED",
      "Достигнут лимит карточек на доске.",
      { limit },
    ),

  boardColumnLimitReached: () =>
    createContentError(
      422,
      "BOARD_COLUMN_LIMIT_REACHED",
      "Достигнут лимит колонок на доске.",
      { limit: 10 },
    ),

  boardActionItemLimitReached: () =>
    createContentError(
      422,
      "BOARD_ACTION_ITEM_LIMIT_REACHED",
      "Достигнут лимит action items на доске.",
      { limit: 200 },
    ),

  columnVoteLimitReached: (columnId: string, limit: number) =>
    createContentError(
      422,
      "COLUMN_VOTE_LIMIT_REACHED",
      "В этой колонке не осталось доступных голосов.",
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
      "Доска слишком велика для безопасного экспорта.",
      details,
    );
  },
} as const;

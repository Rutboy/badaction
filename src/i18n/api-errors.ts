import type { MessageKey } from "./messages/index.ts";
import type { Translate, TranslationValues } from "./translate.ts";

type ApiErrorPayload = {
  error?: {
    code?: unknown;
    details?: unknown;
  };
};

const API_ERROR_KEYS = {
  VALIDATION_ERROR: "errors.api.VALIDATION_ERROR",
  INVALID_CURSOR: "errors.api.INVALID_CURSOR",
  BOARD_OWNER_REQUIRED: "errors.api.BOARD_OWNER_REQUIRED",
  CARD_OWNER_REQUIRED: "errors.api.CARD_OWNER_REQUIRED",
  BOARD_NOT_FOUND: "errors.api.BOARD_NOT_FOUND",
  COLUMN_NOT_FOUND: "errors.api.COLUMN_NOT_FOUND",
  CARD_NOT_FOUND: "errors.api.CARD_NOT_FOUND",
  GROUP_NOT_FOUND: "errors.api.GROUP_NOT_FOUND",
  ACTION_ITEM_NOT_FOUND: "errors.api.ACTION_ITEM_NOT_FOUND",
  STALE_BOARD_REVISION: "errors.api.STALE_BOARD_REVISION",
  BOARD_READ_ONLY: "errors.api.BOARD_READ_ONLY",
  CARDS_DISABLED: "errors.api.CARDS_DISABLED",
  VOTING_DISABLED: "errors.api.VOTING_DISABLED",
  VOTE_LIMIT_CONFLICT: "errors.api.VOTE_LIMIT_CONFLICT",
  VOTE_MOVE_CONFLICT: "errors.api.VOTE_MOVE_CONFLICT",
  CARD_GROUPED: "errors.api.CARD_GROUPED",
  COLUMN_NOT_EMPTY: "errors.api.COLUMN_NOT_EMPTY",
  LAST_COLUMN_DELETE_FORBIDDEN: "errors.api.LAST_COLUMN_DELETE_FORBIDDEN",
  BOARD_CARD_LIMIT_REACHED: "errors.api.BOARD_CARD_LIMIT_REACHED",
  BOARD_COLUMN_LIMIT_REACHED: "errors.api.BOARD_COLUMN_LIMIT_REACHED",
  BOARD_ACTION_ITEM_LIMIT_REACHED: "errors.api.BOARD_ACTION_ITEM_LIMIT_REACHED",
  COLUMN_VOTE_LIMIT_REACHED: "errors.api.COLUMN_VOTE_LIMIT_REACHED",
  BOARD_EXPORT_LIMIT_EXCEEDED: "errors.api.BOARD_EXPORT_LIMIT_EXCEEDED",
  ANONYMOUS_SESSION_INACTIVE: "errors.api.ANONYMOUS_SESSION_INACTIVE",
  SESSION_BOARD_LIMIT_REACHED: "errors.api.SESSION_BOARD_LIMIT_REACHED",
  BOARD_INVITATION_HISTORY_LIMIT_REACHED:
    "errors.api.BOARD_INVITATION_HISTORY_LIMIT_REACHED",
  BOARD_INVITATION_LIMIT_REACHED: "errors.api.BOARD_INVITATION_LIMIT_REACHED",
  BOARD_MEMBERSHIP_HISTORY_LIMIT_REACHED:
    "errors.api.BOARD_MEMBERSHIP_HISTORY_LIMIT_REACHED",
  BOARD_OWNER_ALREADY_EXISTS: "errors.api.BOARD_OWNER_ALREADY_EXISTS",
  BOARD_PARTICIPANT_LIMIT_REACHED: "errors.api.BOARD_PARTICIPANT_LIMIT_REACHED",
  INVITATION_INVALID: "errors.api.INVITATION_INVALID",
  INVITATION_NOT_FOUND: "errors.api.INVITATION_NOT_FOUND",
  MEMBERSHIP_NOT_FOUND: "errors.api.MEMBERSHIP_NOT_FOUND",
  OWNER_CANNOT_LEAVE: "errors.api.OWNER_CANNOT_LEAVE",
  LIKES_NOT_ALLOWED: "errors.api.LIKES_NOT_ALLOWED",
  LIKE_ALREADY_EXISTS: "errors.api.LIKE_ALREADY_EXISTS",
  DATABASE_UNAVAILABLE: "errors.api.DATABASE_UNAVAILABLE",
  RATE_LIMIT_EXCEEDED: "errors.api.RATE_LIMIT_EXCEEDED",
  FORBIDDEN_ORIGIN: "errors.api.FORBIDDEN_ORIGIN",
  INVALID_CONTENT_LENGTH: "errors.api.INVALID_CONTENT_LENGTH",
  INVALID_JSON: "errors.api.INVALID_JSON",
  PAYLOAD_TOO_LARGE: "errors.api.PAYLOAD_TOO_LARGE",
  UNEXPECTED_REQUEST_BODY: "errors.api.UNEXPECTED_REQUEST_BODY",
  UNSUPPORTED_MEDIA_TYPE: "errors.api.UNSUPPORTED_MEDIA_TYPE",
  INTERNAL_ERROR: "errors.api.INTERNAL_ERROR",
} as const satisfies Record<string, MessageKey>;

const safeDetails = (details: unknown): TranslationValues => {
  if (
    typeof details !== "object" ||
    details === null ||
    Array.isArray(details)
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(details).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === "string" ||
        (typeof entry[1] === "number" && Number.isFinite(entry[1])),
    ),
  );
};

export const translateApiErrorPayload = (
  payload: unknown,
  t: Translate,
  fallbackKey: MessageKey = "errors.unknown",
): string => {
  if (typeof payload !== "object" || payload === null) {
    return t("errors.invalidResponse");
  }

  const error = (payload as ApiErrorPayload).error;
  if (!error || typeof error.code !== "string") {
    return t("errors.invalidResponse");
  }

  const key = API_ERROR_KEYS[error.code as keyof typeof API_ERROR_KEYS];
  return key ? t(key, safeDetails(error.details)) : t(fallbackKey);
};

export const readApiError = async (
  response: Response,
  t: Translate,
  fallbackKey: MessageKey = "errors.unknown",
): Promise<string> => {
  const payload = await response.json().catch(() => null);
  return translateApiErrorPayload(payload, t, fallbackKey);
};

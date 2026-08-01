import { Prisma } from "@prisma/client";
import {
  requireActiveBoardMember,
  type BoardAccessContext,
} from "../access/acl-service.ts";
import { ApiError } from "../errors/api-error-base.ts";
import {
  deriveBoardVisitorId,
  getVisitorTokenSecret,
} from "../cookies/visitor-token-core.ts";
import { prisma } from "../prisma/client.ts";
import { safeEqual } from "../security/hmac.ts";
import type { ItemRef, VisitorIdentity } from "./content-types.ts";

export { incrementBoardRevision } from "../realtime/transactional-board-update.ts";

export const POSITION_STEP = 1024;
export const MIN_POSITION = -2_147_483_648;
export const MAX_POSITION = 2_147_483_647;
export const MAX_BOARD_COLUMNS = 10;
export const MAX_GROUP_CARDS = 100;
export const MAX_BOARD_ACTION_ITEMS = 200;

const MAX_TRANSACTION_ATTEMPTS = 5;
const VISITOR_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type ContentTransaction = Prisma.TransactionClient;

export type LockedBoard = {
  id: string;
  title: string;
  cardsEnabled: boolean;
  votingEnabled: boolean;
  readOnly: boolean;
  revision: bigint;
  createdAt: Date;
  expiresAt: Date;
};

export type BoardMutationContext = {
  board: LockedBoard;
  access: BoardAccessContext;
};

export type PositionedItem = ItemRef & {
  position: number;
};

export const deriveContentVisitorIdentity = (
  boardId: string,
  visitorPayload: string,
  env: NodeJS.ProcessEnv = process.env,
): VisitorIdentity => deriveBoardVisitorId(
  visitorPayload,
  boardId,
  getVisitorTokenSecret(env),
) as VisitorIdentity;

export function assertContentVisitorIdentity(
  visitorIdentity: string,
): asserts visitorIdentity is VisitorIdentity {
  if (!VISITOR_IDENTITY_PATTERN.test(visitorIdentity)) {
    throw new RangeError("visitorIdentity must be a 43-character base64url HMAC");
  }
}

export const requireContentVisitorIdentity = (
  boardId: string,
  visitorPayload: string,
  visitorIdentity: string,
  env: NodeJS.ProcessEnv = process.env,
): VisitorIdentity => {
  assertContentVisitorIdentity(visitorIdentity);
  const expected = deriveContentVisitorIdentity(boardId, visitorPayload, env);
  if (!safeEqual(visitorIdentity, expected)) {
    throw new RangeError("visitorIdentity does not match the board-scoped visitor HMAC");
  }

  return visitorIdentity;
};

const boardNotFound = () => new ApiError(404, "BOARD_NOT_FOUND", "Board not found.");

export const isRetryableContentTransactionError = (error: unknown): boolean => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034") {
      return true;
    }

    const sqlState = error.code === "P2010" ? error.meta?.code : undefined;
    return sqlState === "40001" || sqlState === "40P01";
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  return code === "40001" || code === "40P01";
};

const waitBeforeRetry = async (attempt: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, Math.min(10 * 2 ** attempt, 160)));
};

export const withContentTransaction = async <T>(
  operation: (tx: ContentTransaction) => Promise<T>,
): Promise<T> => {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      });
    } catch (error) {
      if (
        !isRetryableContentTransactionError(error)
        || attempt === MAX_TRANSACTION_ATTEMPTS - 1
      ) {
        throw error;
      }

      await waitBeforeRetry(attempt);
    }
  }

  throw new Error("Content transaction retry loop exhausted unexpectedly");
};

export const lockBoardForMutation = async (
  tx: ContentTransaction,
  boardId: string,
  visitorPayload: string,
  now = new Date(),
): Promise<BoardMutationContext> => {
  const rows = await tx.$queryRaw<LockedBoard[]>(Prisma.sql`
    SELECT
      "id",
      "title",
      "cards_enabled" AS "cardsEnabled",
      "voting_enabled" AS "votingEnabled",
      "read_only" AS "readOnly",
      "revision",
      "created_at" AS "createdAt",
      "expires_at" AS "expiresAt"
    FROM "boards"
    WHERE "id" = ${boardId}::uuid
      AND "expires_at" > ${now}
    FOR UPDATE
  `);
  const board = rows[0];
  if (!board) {
    throw boardNotFound();
  }

  const access = await requireActiveBoardMember(boardId, visitorPayload, {
    client: tx,
    lock: true,
    now,
  });

  return { board, access };
};

export const requireOwner = (access: BoardAccessContext): void => {
  if (access.role !== "OWNER") {
    throw new ApiError(
      403,
      "BOARD_OWNER_REQUIRED",
      "Only the board owner can perform this action.",
    );
  }
};

export const requireWritableBoard = (board: LockedBoard): void => {
  if (board.readOnly) {
    throw new ApiError(
      409,
      "BOARD_READ_ONLY",
      "The board is read-only.",
    );
  }
};

export const requireCardsEnabled = (board: LockedBoard): void => {
  if (!board.cardsEnabled) {
    throw new ApiError(
      409,
      "CARDS_DISABLED",
      "Cards are disabled on this board.",
    );
  }
};

export const requireVotingEnabled = (board: LockedBoard): void => {
  if (!board.votingEnabled) {
    throw new ApiError(
      409,
      "VOTING_DISABLED",
      "Voting is disabled on this board.",
    );
  }
};

export const parseRevision = (revision: string): bigint => {
  if (!/^(0|[1-9][0-9]*)$/.test(revision)) {
    throw new RangeError("revision must be a canonical non-negative decimal string");
  }

  return BigInt(revision);
};

export const serializeRevision = (revision: bigint): string => revision.toString(10);

export const requireExpectedRevision = (
  board: LockedBoard,
  expectedRevision: string,
): void => {
  if (board.revision !== parseRevision(expectedRevision)) {
    throw new ApiError(
      409,
      "STALE_BOARD_REVISION",
      "The board changed. Refresh it and try again.",
      { currentRevision: serializeRevision(board.revision) },
    );
  }
};

const refsEqual = (left: ItemRef, right: ItemRef): boolean =>
  left.kind === right.kind && left.id === right.id;

export const resolveItemPlacementIndex = (
  items: readonly PositionedItem[],
  before: ItemRef | null,
  after: ItemRef | null,
): number | null => {
  if (items.length === 0) {
    return before === null && after === null ? 0 : null;
  }

  if (before === null) {
    return after && refsEqual(items[0], after) ? 0 : null;
  }

  if (after === null) {
    return refsEqual(items[items.length - 1], before) ? items.length : null;
  }

  const beforeIndex = items.findIndex((item) => refsEqual(item, before));
  if (beforeIndex < 0 || beforeIndex + 1 >= items.length) {
    return null;
  }

  return refsEqual(items[beforeIndex + 1], after) ? beforeIndex + 1 : null;
};

export const resolveIdPlacementIndex = (
  ids: readonly string[],
  beforeId: string | null,
  afterId: string | null,
): number | null => {
  if (ids.length === 0) {
    return beforeId === null && afterId === null ? 0 : null;
  }

  if (beforeId === null) {
    return afterId === ids[0] ? 0 : null;
  }

  if (afterId === null) {
    return beforeId === ids[ids.length - 1] ? ids.length : null;
  }

  const beforeIndex = ids.indexOf(beforeId);
  return beforeIndex >= 0 && ids[beforeIndex + 1] === afterId ? beforeIndex + 1 : null;
};

export const positionForInsertion = (
  positions: readonly number[],
  insertionIndex: number,
): number | null => {
  const before = insertionIndex > 0 ? positions[insertionIndex - 1] : null;
  const after = insertionIndex < positions.length ? positions[insertionIndex] : null;

  if (before === null && after === null) {
    return POSITION_STEP;
  }

  if (before === null) {
    const position = (after as number) - POSITION_STEP;
    return position >= MIN_POSITION ? position : null;
  }

  if (after === null) {
    const position = before + POSITION_STEP;
    return position <= MAX_POSITION ? position : null;
  }

  if (after - before <= 1) {
    return null;
  }

  return before + Math.floor((after - before) / 2);
};

export const stalePlacement = (revision: bigint) => new ApiError(
  409,
  "STALE_BOARD_REVISION",
  "The board changed. Refresh it and try again.",
  { currentRevision: serializeRevision(revision) },
);

export const comparePositionedItems = (
  left: PositionedItem,
  right: PositionedItem,
): number => left.position - right.position
  || (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0)
  || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

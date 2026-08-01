import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  createOwnerMembershipInTransaction,
  requireActiveBoardMember,
} from "../access/acl-service.ts";
import { getOrCreateSessionInTransaction } from "../access/session-service.ts";
import { getBoardCardLimit, getBoardRetentionDays } from "../config/limits.ts";
import {
  MAX_ACTIVE_OWNED_BOARDS_PER_SESSION,
  MAX_BOARD_TOTAL_VOTE_RECORDS,
} from "../constants/access.ts";
import {
  COLUMNS,
  COLUMN_LABELS,
  LIKEABLE_COLUMNS,
  type ColumnType,
  type VoteColumnType,
} from "../constants/columns.ts";
import { ApiError } from "../errors/api-error-base.ts";
import { prisma } from "../prisma/client.ts";
import {
  POSITION_STEP,
  incrementBoardRevision,
  lockBoardForMutation,
  positionForInsertion,
  requireCardsEnabled,
  requireVotingEnabled,
  requireWritableBoard,
  withContentTransaction,
} from "./content-service-helpers.ts";
import {
  allocateHeadPosition,
  listTopLevelItems,
} from "./top-level-order.ts";
import {
  DEFAULT_CARD_PAGE_SIZE,
  MAX_CARD_PAGE_SIZE,
} from "../validators/pagination.ts";

const DEFAULT_CLEANUP_BATCH_SIZE = 1000;
const MAX_CLEANUP_BATCH_SIZE = 10000;
const CARD_PAGE_SELECT = {
  id: true,
  boardId: true,
  columnId: true,
  text: true,
  createdAt: true,
  _count: { select: { votes: true } },
} satisfies Prisma.CardSelect;
const ACTION_ITEM_PAGE_SELECT = {
  id: true,
  boardId: true,
  text: true,
  assignee: true,
  createdAt: true,
} satisfies Prisma.ActionItemSelect;

type CardPageRow = Prisma.CardGetPayload<{ select: typeof CARD_PAGE_SELECT }>;
type ActionItemPageRow = Prisma.ActionItemGetPayload<{
  select: typeof ACTION_ITEM_PAGE_SELECT;
}>;
type LegacyFeedbackColumn = {
  id: string;
  key: VoteColumnType;
  voteLimit: number;
};

const boardNotFound = () => new ApiError(404, "BOARD_NOT_FOUND", "Доска не найдена");
const columnVoteLimitReached = (columnId?: string, limit = 3) => new ApiError(
  422,
  "COLUMN_VOTE_LIMIT_REACHED",
  limit === 0
    ? "В этой колонке голосование недоступно."
    : "В этой колонке уже использованы все доступные лайки.",
  columnId === undefined ? undefined : { columnId, limit },
);
const invalidCardCursor = () => new ApiError(
  400,
  "INVALID_CURSOR",
  "Курсор не относится к выбранной колонке доски",
);
const boardExportLimitExceeded = (cardLimit: number) => new ApiError(
  422,
  "BOARD_EXPORT_LIMIT_EXCEEDED",
  "Доска превышает безопасный размер экспорта. Обратитесь к оператору.",
  { cardLimit, voteLimit: MAX_BOARD_TOTAL_VOTE_RECORDS },
);
const boardCardLimitReached = (cardLimit: number) => new ApiError(
  422,
  "BOARD_CARD_LIMIT_REACHED",
  `На доске уже достигнут лимит в ${cardLimit} карточек.`,
  { limit: cardLimit },
);

const assertCardPageLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CARD_PAGE_SIZE) {
    throw new RangeError(`limit must be an integer between 1 and ${MAX_CARD_PAGE_SIZE}`);
  }
};

const columnNotFound = () => new ApiError(404, "COLUMN_NOT_FOUND", "Колонка не найдена");

const getLegacyFeedbackColumns = async (
  tx: Prisma.TransactionClient,
  boardId: string,
): Promise<LegacyFeedbackColumn[]> => {
  const columns = await tx.boardColumn.findMany({
    where: { boardId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    take: LIKEABLE_COLUMNS.length,
    select: { id: true, voteLimit: true },
  });

  return columns.map((column, index) => ({
    ...column,
    key: LIKEABLE_COLUMNS[index],
  }));
};

const findLegacyFeedbackColumn = (
  columns: readonly LegacyFeedbackColumn[],
  key: VoteColumnType,
): LegacyFeedbackColumn | undefined => columns.find((column) => column.key === key);

const normalizeLegacyCardText = (text: string): string => {
  const normalized = text.trim();
  if (normalized.length < 1 || normalized.length > 1000) {
    throw new RangeError("card text must contain between 1 and 1000 characters");
  }
  return normalized;
};

const normalizeLegacyActionOwner = (owner: string | null | undefined): string => {
  if (owner === null || owner === undefined) {
    throw new RangeError("action owner must contain between 1 and 120 characters");
  }
  const normalized = owner.trim();
  if (normalized.length < 1 || normalized.length > 120) {
    throw new RangeError("action owner must contain between 1 and 120 characters");
  }
  return normalized;
};

const allocateLegacyActionHeadPosition = async (
  tx: Prisma.TransactionClient,
  boardId: string,
): Promise<number> => {
  const actionItems = await tx.actionItem.findMany({
    where: { boardId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, position: true },
  });
  let position = positionForInsertion(actionItems.map((item) => item.position), 0);
  if (position !== null) {
    return position;
  }

  const positions: number[] = [];
  for (const [index, actionItem] of actionItems.entries()) {
    const rebalancedPosition = (index + 1) * POSITION_STEP;
    positions.push(rebalancedPosition);
    if (actionItem.position !== rebalancedPosition) {
      await tx.actionItem.update({
        where: { id: actionItem.id },
        data: { position: rebalancedPosition },
      });
    }
  }
  position = positionForInsertion(positions, 0);
  if (position === null) {
    throw new Error("Could not allocate a legacy action-item head position after rebalance");
  }
  return position;
};

const serializeCard = (card: CardPageRow, column: VoteColumnType) => ({
  id: card.id,
  boardId: card.boardId,
  column,
  text: card.text,
  owner: null,
  likesCount: card._count.votes,
  createdAt: card.createdAt.toISOString(),
});

const serializeActionItem = (actionItem: ActionItemPageRow) => ({
  id: actionItem.id,
  boardId: actionItem.boardId,
  column: "ACTIONS" as const,
  text: actionItem.text,
  owner: actionItem.assignee,
  likesCount: 0,
  createdAt: actionItem.createdAt.toISOString(),
});

const getCardPageInTransaction = async ({
  tx,
  boardId,
  column,
  feedbackColumns,
  cursor,
  limit,
}: {
  tx: Prisma.TransactionClient;
  boardId: string;
  column: ColumnType;
  feedbackColumns: readonly LegacyFeedbackColumn[];
  cursor?: string;
  limit: number;
}) => {
  if (column === "ACTIONS") {
    const cursorActionItem = cursor
      ? await tx.actionItem.findFirst({
          where: { id: cursor, boardId },
          select: { id: true, createdAt: true },
        })
      : null;

    if (cursor && !cursorActionItem) {
      throw invalidCardCursor();
    }

    const cursorWhere: Prisma.ActionItemWhereInput = cursorActionItem
      ? {
          OR: [
            { createdAt: { lt: cursorActionItem.createdAt } },
            { createdAt: cursorActionItem.createdAt, id: { lt: cursorActionItem.id } },
          ],
        }
      : {};
    const [rows, totalCount] = await Promise.all([
      tx.actionItem.findMany({
        where: { boardId, ...cursorWhere },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: ACTION_ITEM_PAGE_SELECT,
      }),
      tx.actionItem.count({ where: { boardId } }),
    ]);
    const hasNextPage = rows.length > limit;
    const cards = rows.slice(0, limit).map(serializeActionItem);
    return {
      column,
      cards,
      totalCount,
      nextCursor: hasNextPage ? cards.at(-1)?.id ?? null : null,
    };
  }

  const feedbackColumn = findLegacyFeedbackColumn(feedbackColumns, column);
  if (!feedbackColumn) {
    if (cursor) {
      throw invalidCardCursor();
    }
    return { column, cards: [], totalCount: 0, nextCursor: null };
  }
  const cursorCard = cursor
    ? await tx.card.findFirst({
        where: { id: cursor, boardId, columnId: feedbackColumn.id },
        select: { id: true, createdAt: true },
      })
    : null;

  if (cursor && !cursorCard) {
    throw invalidCardCursor();
  }

  const cursorWhere: Prisma.CardWhereInput = cursorCard
    ? {
        OR: [
          { createdAt: { lt: cursorCard.createdAt } },
          { createdAt: cursorCard.createdAt, id: { lt: cursorCard.id } },
        ],
      }
    : {};

  const [rows, totalCount] = await Promise.all([
    tx.card.findMany({
      where: { boardId, columnId: feedbackColumn.id, ...cursorWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      select: CARD_PAGE_SELECT,
    }),
    tx.card.count({ where: { boardId, columnId: feedbackColumn.id } }),
  ]);
  const hasNextPage = rows.length > limit;
  const cards = rows.slice(0, limit).map((card) => serializeCard(card, column));

  return {
    column,
    cards,
    totalCount,
    nextCursor: hasNextPage ? cards.at(-1)?.id ?? null : null,
  };
};

const isQuotaSlotConflict = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }

  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.some((value) => value === "quota_slot" || value === "quotaSlot");
  }

  return typeof target === "string"
    && (target.includes("quota_slot") || target.includes("quotaSlot"));
};

const assertCleanupBatchSize = (batchSize: number): void => {
  if (
    !Number.isSafeInteger(batchSize)
    || batchSize < 1
    || batchSize > MAX_CLEANUP_BATCH_SIZE
  ) {
    throw new RangeError(
      `batchSize must be an integer between 1 and ${MAX_CLEANUP_BATCH_SIZE}`,
    );
  }
};

export const createBoard = async (visitorPayload: string) => {
  const boardId = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + getBoardRetentionDays() * 24 * 60 * 60 * 1000,
  );
  const title = `Ретроспектива ${boardId.slice(0, 8).toLowerCase()}`;

  return withContentTransaction(async (tx) => {
    const session = await getOrCreateSessionInTransaction(tx, visitorPayload, { now: createdAt });
    const lockedSessions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "anonymous_sessions"
      WHERE "id" = ${session.id}::uuid
        AND "revoked_at" IS NULL
        AND "expires_at" > ${createdAt}
      FOR UPDATE
    `);
    if (lockedSessions.length !== 1) {
      throw new ApiError(
        401,
        "ANONYMOUS_SESSION_INACTIVE",
        "Анонимная сессия недействительна. Обновите страницу и повторите запрос.",
      );
    }

    const ownedBoards = await tx.boardMembership.count({
      where: {
        sessionId: session.id,
        role: "OWNER",
        revokedAt: null,
        board: { expiresAt: { gt: createdAt } },
      },
    });
    if (ownedBoards >= MAX_ACTIVE_OWNED_BOARDS_PER_SESSION) {
      throw new ApiError(
        422,
        "SESSION_BOARD_LIMIT_REACHED",
        `Одна анонимная сессия может владеть не более чем ${MAX_ACTIVE_OWNED_BOARDS_PER_SESSION} активными досками.`,
        { limit: MAX_ACTIVE_OWNED_BOARDS_PER_SESSION },
      );
    }

    const board = await tx.board.create({
      data: {
        id: boardId,
        title,
        createdAt,
        expiresAt,
      },
      select: { id: true, createdAt: true, expiresAt: true },
    });
    await createOwnerMembershipInTransaction(tx, {
      boardId: board.id,
      sessionId: session.id,
    });
    await tx.boardColumn.createMany({
      data: LIKEABLE_COLUMNS.map((key, index) => ({
        boardId: board.id,
        title: COLUMN_LABELS[key],
        position: (index + 1) * POSITION_STEP,
        voteLimit: 3,
      })),
    });

    return board;
  });
};

export const getBoard = async (
  boardId: string,
  visitorPayload: string,
  limit = DEFAULT_CARD_PAGE_SIZE,
) => {
  assertCardPageLimit(limit);

  return prisma.$transaction(async (tx) => {
    const access = await requireActiveBoardMember(boardId, visitorPayload, { client: tx });
    const board = await tx.board.findFirst({
      where: {
        id: boardId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, createdAt: true, expiresAt: true },
    });

    if (!board) {
      throw boardNotFound();
    }

    const feedbackColumns = await getLegacyFeedbackColumns(tx, boardId);
    const pages = await Promise.all(
      COLUMNS.map((column) => getCardPageInTransaction({
        tx,
        boardId,
        column: column.key,
        feedbackColumns,
        limit,
      })),
    );

    return {
      id: board.id,
      createdAt: board.createdAt.toISOString(),
      expiresAt: board.expiresAt.toISOString(),
      access: {
        membershipId: access.membershipId,
        role: access.role,
        displayName: access.displayName,
      },
      columns: COLUMNS.map((column) => {
        const page = pages.find((candidate) => candidate.column === column.key);
        if (!page) {
          throw new Error(`Missing card page for column ${column.key}`);
        }

        return {
          key: column.key,
          label: column.label,
          cards: page.cards,
          totalCount: page.totalCount,
          nextCursor: page.nextCursor,
        };
      }),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
};

export const getCardPage = async (
  boardId: string,
  visitorPayload: string,
  column: ColumnType,
  cursor?: string,
  limit = DEFAULT_CARD_PAGE_SIZE,
) => {
  assertCardPageLimit(limit);

  return prisma.$transaction(async (tx) => {
    await requireActiveBoardMember(boardId, visitorPayload, { client: tx });
    const board = await tx.board.findFirst({
      where: {
        id: boardId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!board) {
      throw boardNotFound();
    }

    const feedbackColumns = await getLegacyFeedbackColumns(tx, boardId);
    return getCardPageInTransaction({
      tx,
      boardId,
      column,
      feedbackColumns,
      cursor,
      limit,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
};

export const createCard = async (
  boardId: string,
  visitorPayload: string,
  payload: { column: "WENT_WELL" | "TO_IMPROVE" | "ACTIONS"; text: string; owner?: string | null },
) => {
  const cardLimit = getBoardCardLimit();
  return withContentTransaction(async (tx) => {
    const context = await lockBoardForMutation(tx, boardId, visitorPayload);
    requireWritableBoard(context.board);
    if (payload.column !== "ACTIONS") {
      requireCardsEnabled(context.board);
    }

    const [cardCount, actionItemCount] = await Promise.all([
      tx.card.count({ where: { boardId } }),
      tx.actionItem.count({ where: { boardId } }),
    ]);
    if (cardCount + actionItemCount >= cardLimit) {
      throw boardCardLimitReached(cardLimit);
    }

    const text = normalizeLegacyCardText(payload.text);
    if (payload.column === "ACTIONS") {
      const position = await allocateLegacyActionHeadPosition(tx, boardId);
      const actionItem = await tx.actionItem.create({
        data: {
          boardId,
          text,
          assignee: normalizeLegacyActionOwner(payload.owner),
          completed: false,
          position,
          sourceCardId: null,
        },
        select: ACTION_ITEM_PAGE_SELECT,
      });
      await incrementBoardRevision(tx, boardId, "action.created");
      return serializeActionItem(actionItem);
    }

    const legacyColumn = payload.column;
    const feedbackColumns = await getLegacyFeedbackColumns(tx, boardId);
    const feedbackColumn = findLegacyFeedbackColumn(feedbackColumns, legacyColumn);
    if (!feedbackColumn) {
      throw columnNotFound();
    }
    const items = await listTopLevelItems(tx, boardId, feedbackColumn.id);
    const position = await allocateHeadPosition(tx, items);
    const card = await tx.card.create({
      data: {
        boardId,
        columnId: feedbackColumn.id,
        text,
        author: null,
        createdByMembershipId: context.access.membershipId,
        position,
      },
      select: CARD_PAGE_SELECT,
    });
    await incrementBoardRevision(tx, boardId, "card.created");
    return serializeCard(card, legacyColumn);
  });
};

export const likeCard = async (
  boardId: string,
  cardId: string,
  visitorPayload: string,
  visitorToken: string,
) => {
  try {
    return await withContentTransaction(async (tx) => {
      const context = await lockBoardForMutation(tx, boardId, visitorPayload);
      requireWritableBoard(context.board);
      requireVotingEnabled(context.board);

      const card = await tx.card.findFirst({
        where: { id: cardId, boardId },
        select: { id: true, columnId: true },
      });
      if (!card) {
        const actionItem = await tx.actionItem.findFirst({
          where: { id: cardId, boardId },
          select: { id: true },
        });
        if (actionItem) {
          throw new ApiError(403, "LIKES_NOT_ALLOWED", "Лайки для этой колонки запрещены");
        }
        throw new ApiError(404, "CARD_NOT_FOUND", "Карточка не найдена");
      }

      const feedbackColumns = await getLegacyFeedbackColumns(tx, boardId);
      const feedbackColumn = feedbackColumns.find((column) => column.id === card.columnId);
      if (!feedbackColumn) {
        throw new ApiError(403, "LIKES_NOT_ALLOWED", "Лайки для этой колонки запрещены");
      }

      const existing = await tx.vote.findUnique({
        where: {
          cardId_visitorToken: {
            cardId,
            visitorToken,
          },
        },
      });

      if (existing) {
        throw new ApiError(409, "LIKE_ALREADY_EXISTS", "Вы уже лайкнули эту карточку");
      }

      const usedQuotaSlots = await tx.vote.findMany({
        where: { boardId, columnId: feedbackColumn.id, visitorToken },
        select: { quotaSlot: true },
      });
      const usedQuotaSlotValues = new Set(usedQuotaSlots.map((vote) => vote.quotaSlot));
      let quotaSlot: number | undefined;
      for (let candidate = 1; candidate <= feedbackColumn.voteLimit; candidate += 1) {
        if (!usedQuotaSlotValues.has(candidate)) {
          quotaSlot = candidate;
          break;
        }
      }

      if (quotaSlot === undefined) {
        throw columnVoteLimitReached(feedbackColumn.id, feedbackColumn.voteLimit);
      }

      await tx.vote.create({
        data: {
          boardId,
          cardId,
          columnId: feedbackColumn.id,
          visitorToken,
          quotaSlot,
        },
      });

      const likesCount = await tx.vote.count({ where: { cardId } });
      await incrementBoardRevision(tx, boardId, "vote.updated");

      return {
        cardId,
        likesCount,
        remainingVotesInColumn: Math.max(
          0,
          feedbackColumn.voteLimit - (usedQuotaSlots.length + 1),
        ),
      };
    });
  } catch (error) {
    if (isQuotaSlotConflict(error)) {
      throw columnVoteLimitReached();
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "LIKE_ALREADY_EXISTS", "Вы уже лайкнули эту карточку");
    }

    throw error;
  }
};

export const getExportRows = async (
  boardId: string,
  visitorPayload: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  const cardLimit = getBoardCardLimit(env);
  const exportData = await prisma.$transaction(async (tx) => {
    await requireActiveBoardMember(boardId, visitorPayload, { client: tx });

    const [board, feedbackColumns, boundedCards, boundedActionItems, boundedVotes] =
      await Promise.all([
        tx.board.findFirst({
          where: {
            id: boardId,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        }),
        getLegacyFeedbackColumns(tx, boardId),
        tx.card.findMany({
          where: { boardId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: cardLimit + 1,
          select: CARD_PAGE_SELECT,
        }),
        tx.actionItem.findMany({
          where: { boardId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: cardLimit + 1,
          select: ACTION_ITEM_PAGE_SELECT,
        }),
        tx.vote.findMany({
          where: { boardId },
          take: MAX_BOARD_TOTAL_VOTE_RECORDS + 1,
          select: { id: true },
        }),
      ]);
    if (!board) {
      throw boardNotFound();
    }
    if (
      boundedCards.length + boundedActionItems.length > cardLimit
      || boundedVotes.length > MAX_BOARD_TOTAL_VOTE_RECORDS
    ) {
      throw boardExportLimitExceeded(cardLimit);
    }

    return { feedbackColumns, cards: boundedCards, actionItems: boundedActionItems };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

  const legacyColumnById = new Map(
    exportData.feedbackColumns.map((column) => [column.id, column.key] as const),
  );
  const rows = [
    ...exportData.cards.flatMap((card) => {
      const column = legacyColumnById.get(card.columnId);
      return column
        ? [{
            cardId: card.id,
            boardId: card.boardId,
            column,
            columnLabel: COLUMN_LABELS[column],
            text: card.text,
            likesCount: card._count.votes,
            owner: null,
            createdAt: card.createdAt,
          }]
        : [];
    }),
    ...exportData.actionItems.map((actionItem) => ({
      cardId: actionItem.id,
      boardId: actionItem.boardId,
      column: "ACTIONS" as const,
      columnLabel: COLUMN_LABELS.ACTIONS,
      text: actionItem.text,
      likesCount: 0,
      owner: actionItem.assignee,
      createdAt: actionItem.createdAt,
    })),
  ];
  rows.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()
    || right.cardId.localeCompare(left.cardId));

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  }));
};

export const cleanupExpiredBoards = async (
  batchSize = DEFAULT_CLEANUP_BATCH_SIZE,
): Promise<number> => {
  assertCleanupBatchSize(batchSize);

  const deleted = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH expired AS (
      SELECT "id"
      FROM "boards"
      WHERE "expires_at" <= CURRENT_TIMESTAMP
      ORDER BY "expires_at"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "boards" AS board
    USING expired
    WHERE board."id" = expired."id"
    RETURNING board."id"
  `);

  return deleted.length;
};

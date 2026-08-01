import { Prisma } from "@prisma/client";
import { ApiError } from "../errors/api-error-base.ts";
import type { ColumnPlacement } from "./content-types.ts";
import {
  MAX_BOARD_COLUMNS,
  MAX_POSITION,
  POSITION_STEP,
  incrementBoardRevision,
  lockBoardForMutation,
  positionForInsertion,
  requireCardsEnabled,
  requireExpectedRevision,
  requireOwner,
  requireWritableBoard,
  resolveIdPlacementIndex,
  serializeRevision,
  stalePlacement,
  withContentTransaction,
  type ContentTransaction,
  type LockedBoard,
} from "./content-service-helpers.ts";
import {
  compactColumnVoteSlots,
  moveVotesBetweenColumns,
} from "./vote-move-service.ts";

type ColumnRow = {
  id: string;
  boardId: string;
  title: string;
  position: number;
  voteLimit: number;
};

type ColumnPatch = {
  title?: string;
  voteLimit?: number;
  expectedRevision?: string;
};

export type DeleteColumnPayload =
  | { expectedRevision: string }
  | {
      strategy: "moveCards";
      targetColumnId: string;
      expectedRevision: string;
    }
  | {
      strategy: "deleteCards";
      confirmDeleteCards: true;
      expectedRevision: string;
    };

const columnNotFound = () => new ApiError(404, "COLUMN_NOT_FOUND", "Колонка не найдена.");

const requireColumnPlacementResources = (
  columns: readonly ColumnRow[],
  placement: ColumnPlacement,
): void => {
  const columnIds = new Set(columns.map((column) => column.id));
  if (
    (placement.beforeColumnId !== null && !columnIds.has(placement.beforeColumnId))
    || (placement.afterColumnId !== null && !columnIds.has(placement.afterColumnId))
  ) {
    throw columnNotFound();
  }
};

const normalizeColumnTitle = (title: string): string => {
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 80) {
    throw new RangeError("column title must contain between 1 and 80 characters");
  }
  return normalized;
};

const assertVoteLimit = (voteLimit: number): void => {
  if (!Number.isSafeInteger(voteLimit) || voteLimit < 0 || voteLimit > 20) {
    throw new RangeError("voteLimit must be an integer between 0 and 20");
  }
};

const serializeColumn = (column: ColumnRow) => ({
  id: column.id,
  title: column.title,
  position: column.position,
  voteLimit: column.voteLimit,
});

const listColumns = (tx: ContentTransaction, boardId: string) => tx.boardColumn.findMany({
  where: { boardId },
  orderBy: [{ position: "asc" }, { id: "asc" }],
  select: { id: true, boardId: true, title: true, position: true, voteLimit: true },
});

const rebalanceColumns = async (
  tx: ContentTransaction,
  columns: readonly ColumnRow[],
): Promise<ColumnRow[]> => {
  const rebalanced: ColumnRow[] = [];
  for (const [index, column] of columns.entries()) {
    const position = (index + 1) * POSITION_STEP;
    if (column.position !== position) {
      await tx.boardColumn.update({ where: { id: column.id }, data: { position } });
    }
    rebalanced.push({ ...column, position });
  }
  return rebalanced;
};

const resolveColumnPosition = async (
  tx: ContentTransaction,
  board: LockedBoard,
  columns: readonly ColumnRow[],
  placement: ColumnPlacement,
): Promise<number> => {
  const insertionIndex = resolveIdPlacementIndex(
    columns.map((column) => column.id),
    placement.beforeColumnId,
    placement.afterColumnId,
  );
  if (insertionIndex === null) {
    throw stalePlacement(board.revision);
  }

  let position = positionForInsertion(
    columns.map((column) => column.position),
    insertionIndex,
  );
  if (position !== null) {
    return position;
  }

  const rebalanced = await rebalanceColumns(tx, columns);
  position = positionForInsertion(
    rebalanced.map((column) => column.position),
    insertionIndex,
  );
  if (position === null) {
    throw new Error("Could not allocate a column position after rebalance");
  }
  return position;
};

export const createBoardColumn = async (
  boardId: string,
  visitorPayload: string,
  payload: {
    title: string;
    voteLimit: number;
    placement: ColumnPlacement;
    expectedRevision: string;
  },
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  requireExpectedRevision(board, payload.expectedRevision);
  const columns = await listColumns(tx, boardId);
  if (columns.length >= MAX_BOARD_COLUMNS) {
    throw new ApiError(
      422,
      "BOARD_COLUMN_LIMIT_REACHED",
      `На доске может быть не более ${MAX_BOARD_COLUMNS} колонок.`,
      { limit: MAX_BOARD_COLUMNS },
    );
  }
  assertVoteLimit(payload.voteLimit);
  requireColumnPlacementResources(columns, payload.placement);
  const position = await resolveColumnPosition(tx, board, columns, payload.placement);
  const column = await tx.boardColumn.create({
    data: {
      boardId,
      title: normalizeColumnTitle(payload.title),
      position,
      voteLimit: payload.voteLimit,
    },
    select: { id: true, boardId: true, title: true, position: true, voteLimit: true },
  });
  const revision = await incrementBoardRevision(tx, boardId, "column.created");
  return { revision: serializeRevision(revision), column: serializeColumn(column) };
});

export const updateBoardColumn = async (
  boardId: string,
  columnId: string,
  visitorPayload: string,
  patch: ColumnPatch,
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  const column = await tx.boardColumn.findFirst({
    where: { id: columnId, boardId },
    select: { id: true, boardId: true, title: true, position: true, voteLimit: true },
  });
  if (!column) {
    throw columnNotFound();
  }

  const title = patch.title === undefined ? column.title : normalizeColumnTitle(patch.title);
  const voteLimit = patch.voteLimit ?? column.voteLimit;
  if (patch.voteLimit !== undefined) {
    assertVoteLimit(patch.voteLimit);
    if (patch.expectedRevision === undefined) {
      throw new RangeError("expectedRevision is required when voteLimit is present");
    }
    requireExpectedRevision(board, patch.expectedRevision);
  }
  const changed = title !== column.title || voteLimit !== column.voteLimit;
  if (!changed) {
    return { revision: serializeRevision(board.revision), column: serializeColumn(column) };
  }

  if (voteLimit < column.voteLimit) {
    await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "votes"
      WHERE "board_id" = ${boardId}::uuid
        AND "column_id" = ${columnId}::uuid
      FOR UPDATE
    `);
    const conflicts = await tx.$queryRaw<Array<{ visitorToken: string }>>(Prisma.sql`
      SELECT "visitor_token" AS "visitorToken"
      FROM "votes"
      WHERE "board_id" = ${boardId}::uuid
        AND "column_id" = ${columnId}::uuid
      GROUP BY "visitor_token"
      HAVING COUNT(*) > ${voteLimit}
      LIMIT 1
    `);
    if (conflicts.length > 0) {
      throw new ApiError(
        409,
        "VOTE_LIMIT_CONFLICT",
        "Новый лимит меньше уже использованного числа голосов.",
        { columnId, requestedLimit: voteLimit },
      );
    }
    await compactColumnVoteSlots(tx, boardId, columnId);
  }

  const updated = await tx.boardColumn.update({
    where: { id: column.id },
    data: { title, voteLimit },
    select: { id: true, boardId: true, title: true, position: true, voteLimit: true },
  });
  const revision = await incrementBoardRevision(tx, boardId, "column.updated");
  return { revision: serializeRevision(revision), column: serializeColumn(updated) };
});

export const moveBoardColumn = async (
  boardId: string,
  columnId: string,
  visitorPayload: string,
  payload: { placement: ColumnPlacement; expectedRevision: string },
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  requireExpectedRevision(board, payload.expectedRevision);
  const allColumns = await listColumns(tx, boardId);
  const column = allColumns.find((candidate) => candidate.id === columnId);
  if (!column) {
    throw columnNotFound();
  }
  requireColumnPlacementResources(allColumns, payload.placement);
  const remaining = allColumns.filter((candidate) => candidate.id !== columnId);
  const requestedIndex = resolveIdPlacementIndex(
    remaining.map((candidate) => candidate.id),
    payload.placement.beforeColumnId,
    payload.placement.afterColumnId,
  );
  if (requestedIndex === null) {
    throw stalePlacement(board.revision);
  }
  if (requestedIndex === allColumns.indexOf(column)) {
    return { revision: serializeRevision(board.revision), column: serializeColumn(column) };
  }
  const position = await resolveColumnPosition(tx, board, remaining, payload.placement);
  const updated = await tx.boardColumn.update({
    where: { id: column.id },
    data: { position },
    select: { id: true, boardId: true, title: true, position: true, voteLimit: true },
  });
  const revision = await incrementBoardRevision(tx, boardId, "column.moved");
  return { revision: serializeRevision(revision), column: serializeColumn(updated) };
});

type TopLevelRow = {
  id: string;
  kind: "CARD" | "GROUP";
  position: number;
};

const listTopLevelItems = async (
  tx: ContentTransaction,
  boardId: string,
  columnId: string,
): Promise<TopLevelRow[]> => {
  const [cards, groups] = await Promise.all([
    tx.card.findMany({
      where: { boardId, columnId, groupId: null },
      select: { id: true, position: true },
    }),
    tx.cardGroup.findMany({
      where: { boardId, columnId },
      select: { id: true, position: true },
    }),
  ]);
  return [
    ...cards.map((card) => ({ ...card, kind: "CARD" as const })),
    ...groups.map((group) => ({ ...group, kind: "GROUP" as const })),
  ].sort((left, right) => left.position - right.position
    || (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
};

const setTopLevelPosition = async (
  tx: ContentTransaction,
  item: TopLevelRow,
  position: number,
): Promise<void> => {
  if (item.kind === "CARD") {
    await tx.card.update({ where: { id: item.id }, data: { position } });
  } else {
    await tx.cardGroup.update({ where: { id: item.id }, data: { position } });
  }
};

const appendMovedItems = async (
  tx: ContentTransaction,
  targetItems: readonly TopLevelRow[],
  movedItems: readonly TopLevelRow[],
): Promise<void> => {
  if (movedItems.length === 0) {
    return;
  }
  const lastPosition = targetItems.at(-1)?.position ?? 0;
  const canAppend = lastPosition + movedItems.length * POSITION_STEP <= MAX_POSITION;
  if (canAppend) {
    for (const [index, item] of movedItems.entries()) {
      await setTopLevelPosition(tx, item, lastPosition + (index + 1) * POSITION_STEP);
    }
    return;
  }

  for (const [index, item] of [...targetItems, ...movedItems].entries()) {
    await setTopLevelPosition(tx, item, (index + 1) * POSITION_STEP);
  }
};

export const deleteBoardColumn = async (
  boardId: string,
  columnId: string,
  visitorPayload: string,
  payload: DeleteColumnPayload,
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  requireExpectedRevision(board, payload.expectedRevision);
  const columns = await listColumns(tx, boardId);
  const column = columns.find((candidate) => candidate.id === columnId);
  if (!column) {
    throw columnNotFound();
  }
  if (columns.length <= 1) {
    throw new ApiError(
      409,
      "LAST_COLUMN_DELETE_FORBIDDEN",
      "Нельзя удалить последнюю колонку доски.",
    );
  }

  const cardCount = await tx.card.count({ where: { boardId, columnId } });
  const strategy = "strategy" in payload ? payload.strategy : undefined;
  if (cardCount > 0 && strategy === undefined) {
    throw new ApiError(409, "COLUMN_NOT_EMPTY", "Колонка содержит карточки.");
  }
  if (cardCount > 0) {
    requireCardsEnabled(board);
  }

  if (strategy === "moveCards") {
    const movePayload = payload as Extract<DeleteColumnPayload, { strategy: "moveCards" }>;
    const targetColumn = columns.find((candidate) => candidate.id === movePayload.targetColumnId);
    if (!targetColumn || targetColumn.id === columnId) {
      throw columnNotFound();
    }
    const [sourceItems, targetItems, cards] = await Promise.all([
      listTopLevelItems(tx, boardId, columnId),
      listTopLevelItems(tx, boardId, targetColumn.id),
      tx.card.findMany({
        where: { boardId, columnId },
        select: { id: true },
      }),
    ]);
    const cardIds = cards.map((card) => card.id);
    await moveVotesBetweenColumns({
      tx,
      boardId,
      cardIds,
      sourceColumnId: columnId,
      targetColumnId: targetColumn.id,
      targetVoteLimit: targetColumn.voteLimit,
    });
    await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
    await tx.card.updateMany({
      where: { boardId, columnId },
      data: { columnId: targetColumn.id },
    });
    await tx.cardGroup.updateMany({
      where: { boardId, columnId },
      data: { columnId: targetColumn.id },
    });
    await appendMovedItems(tx, targetItems, sourceItems);
  } else if (strategy === "deleteCards") {
    await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
    await tx.vote.deleteMany({ where: { boardId, columnId } });
    await tx.cardGroup.deleteMany({ where: { boardId, columnId } });
    await tx.card.deleteMany({ where: { boardId, columnId } });
  }

  await tx.boardColumn.delete({ where: { id: column.id } });
  const revision = await incrementBoardRevision(tx, boardId, "column.deleted");
  return { revision: serializeRevision(revision) };
});

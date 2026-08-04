import type { ItemPlacement, ItemRef } from "./content-types.ts";
import {
  POSITION_STEP,
  comparePositionedItems,
  positionForInsertion,
  resolveItemPlacementIndex,
  stalePlacement,
  type ContentTransaction,
  type LockedBoard,
  type PositionedItem,
} from "./content-service-helpers.ts";
import { loadUniqueGroupVoteCounts } from "./group-vote-counts.ts";

export type TopLevelItemRow = PositionedItem;

export const listTopLevelItems = async (
  tx: ContentTransaction,
  boardId: string,
  columnId: string,
): Promise<TopLevelItemRow[]> => {
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
  ].sort(comparePositionedItems);
};

export const listTopLevelItemsByVotes = async (
  tx: ContentTransaction,
  boardId: string,
  columnId: string,
): Promise<TopLevelItemRow[]> => {
  const items = await listTopLevelItems(tx, boardId, columnId);
  const cardIds = items
    .filter((item) => item.kind === "CARD")
    .map((item) => item.id);
  const groupIds = items
    .filter((item) => item.kind === "GROUP")
    .map((item) => item.id);
  const [cards, groupVoteCounts] = await Promise.all([
    cardIds.length === 0
      ? Promise.resolve([])
      : tx.card.findMany({
          where: { boardId, columnId, id: { in: cardIds }, groupId: null },
          select: { id: true, _count: { select: { votes: true } } },
        }),
    loadUniqueGroupVoteCounts(tx, boardId, groupIds),
  ]);
  const cardVoteCounts = new Map(
    cards.map((card) => [card.id, card._count.votes]),
  );
  const voteCount = (item: TopLevelItemRow): number =>
    item.kind === "CARD"
      ? (cardVoteCounts.get(item.id) ?? 0)
      : (groupVoteCounts.get(item.id) ?? 0);

  return [...items].sort((left, right) => {
    const voteDifference = voteCount(right) - voteCount(left);
    return voteDifference !== 0
      ? voteDifference
      : comparePositionedItems(left, right);
  });
};

export const setTopLevelPosition = async (
  tx: ContentTransaction,
  item: TopLevelItemRow,
  position: number,
): Promise<void> => {
  if (item.kind === "CARD") {
    await tx.card.update({ where: { id: item.id }, data: { position } });
    return;
  }

  await tx.cardGroup.update({ where: { id: item.id }, data: { position } });
};

export const rebalanceTopLevelItems = async (
  tx: ContentTransaction,
  items: readonly TopLevelItemRow[],
): Promise<TopLevelItemRow[]> => {
  const result: TopLevelItemRow[] = [];
  for (const [index, item] of items.entries()) {
    const position = (index + 1) * POSITION_STEP;
    if (item.position !== position) {
      await setTopLevelPosition(tx, item, position);
    }
    result.push({ ...item, position });
  }
  return result;
};

const sameItem = (left: ItemRef, right: ItemRef): boolean =>
  left.kind === right.kind && left.id === right.id;

const insertAt = <T>(values: readonly T[], value: T, index: number): T[] => [
  ...values.slice(0, index),
  value,
  ...values.slice(index),
];

export const materializeTopLevelItemMove = async ({
  tx,
  board,
  boardId,
  sourceColumnId,
  targetColumnId,
  movedItem,
  placement,
  voteSortedColumnIds,
}: {
  tx: ContentTransaction;
  board: LockedBoard;
  boardId: string;
  sourceColumnId: string;
  targetColumnId: string;
  movedItem: ItemRef;
  placement: ItemPlacement;
  voteSortedColumnIds: readonly string[];
}): Promise<number> => {
  const affectedColumnIds = new Set([sourceColumnId, targetColumnId]);
  if (voteSortedColumnIds.some((columnId) => !affectedColumnIds.has(columnId))) {
    throw new RangeError(
      "Vote-sorted columns must be the source or target of the move",
    );
  }
  const voteSortedColumns = new Set(voteSortedColumnIds);
  const loadItems = (columnId: string) =>
    voteSortedColumns.has(columnId)
      ? listTopLevelItemsByVotes(tx, boardId, columnId)
      : listTopLevelItems(tx, boardId, columnId);
  const sourceItems = await loadItems(sourceColumnId);
  const targetItems =
    sourceColumnId === targetColumnId
      ? sourceItems
      : await loadItems(targetColumnId);
  const item = sourceItems.find((candidate) => sameItem(candidate, movedItem));
  if (!item) {
    throw new Error("The moved item is missing from its source column");
  }
  const targetWithoutMovedItem = targetItems.filter(
    (candidate) => !sameItem(candidate, movedItem),
  );
  const targetIndex = resolveItemPlacementIndex(
    targetWithoutMovedItem,
    placement.before,
    placement.after,
  );
  if (targetIndex === null) {
    throw stalePlacement(board.revision);
  }
  const finalTargetItems = insertAt(targetWithoutMovedItem, item, targetIndex);

  if (sourceColumnId !== targetColumnId) {
    await rebalanceTopLevelItems(
      tx,
      sourceItems.filter((candidate) => !sameItem(candidate, movedItem)),
    );
  }
  const rebalancedTargetItems = await rebalanceTopLevelItems(
    tx,
    finalTargetItems,
  );
  const moved = rebalancedTargetItems.find((candidate) =>
    sameItem(candidate, movedItem),
  );
  if (!moved) {
    throw new Error("The moved item is missing from the final target order");
  }
  return moved.position;
};

export const allocateTopLevelPosition = async (
  tx: ContentTransaction,
  board: LockedBoard,
  items: readonly TopLevelItemRow[],
  placement: ItemPlacement,
): Promise<number> => {
  const insertionIndex = resolveItemPlacementIndex(items, placement.before, placement.after);
  if (insertionIndex === null) {
    throw stalePlacement(board.revision);
  }
  let position = positionForInsertion(
    items.map((item) => item.position),
    insertionIndex,
  );
  if (position !== null) {
    return position;
  }

  const rebalanced = await rebalanceTopLevelItems(tx, items);
  position = positionForInsertion(
    rebalanced.map((item) => item.position),
    insertionIndex,
  );
  if (position === null) {
    throw new Error("Could not allocate a top-level position after rebalance");
  }
  return position;
};

export const allocateHeadPosition = async (
  tx: ContentTransaction,
  items: readonly TopLevelItemRow[],
): Promise<number> => {
  if (items.length === 0) {
    return POSITION_STEP;
  }
  const position = positionForInsertion(items.map((item) => item.position), 0);
  if (position !== null) {
    return position;
  }

  const rebalanced = await rebalanceTopLevelItems(tx, items);
  const afterRebalance = positionForInsertion(rebalanced.map((item) => item.position), 0);
  if (afterRebalance === null) {
    throw new Error("Could not allocate a head position after rebalance");
  }
  return afterRebalance;
};

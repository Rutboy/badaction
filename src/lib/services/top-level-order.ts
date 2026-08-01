import type { ItemPlacement } from "./content-types.ts";
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

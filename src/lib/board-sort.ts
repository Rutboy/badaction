import type { BoardItem } from "./pagination/board-state.ts";

export type BoardItemSort = "ORIGINAL" | "VOTES";

const compareOriginalOrder = (left: BoardItem, right: BoardItem): number => {
  const positionDifference = left.position - right.position;
  if (positionDifference !== 0) {
    return positionDifference;
  }

  if (left.kind !== right.kind) {
    return left.kind === "CARD" ? -1 : 1;
  }

  return left.id.localeCompare(right.id);
};

export const sortBoardItemsByVotes = (
  items: readonly BoardItem[],
): BoardItem[] =>
  [...items].sort((left, right) => {
    const voteDifference = right.voteCount - left.voteCount;
    return voteDifference !== 0
      ? voteDifference
      : compareOriginalOrder(left, right);
  });

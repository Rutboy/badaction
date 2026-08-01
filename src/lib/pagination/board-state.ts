import type {
  BoardItem,
  BoardItemsPage,
  BoardSnapshot,
} from "../services/content-types.ts";

export type {
  ActionItemView,
  BoardItem,
  BoardItemsPage,
  BoardSnapshot,
  CardView,
  GroupView,
} from "../services/content-types.ts";

const itemKey = (item: BoardItem): string => `${item.kind}:${item.id}`;

const compareBoardItems = (left: BoardItem, right: BoardItem): number => {
  const positionDifference = left.position - right.position;
  if (positionDifference !== 0) {
    return positionDifference;
  }

  if (left.kind !== right.kind) {
    return left.kind === "CARD" ? -1 : 1;
  }

  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
};

const mergeItems = (
  current: readonly BoardItem[],
  incoming: readonly BoardItem[],
): BoardItem[] => {
  const itemsByKey = new Map(current.map((item) => [itemKey(item), item]));
  for (const item of incoming) {
    itemsByKey.set(itemKey(item), item);
  }

  return Array.from(itemsByKey.values()).sort(compareBoardItems);
};

export const mergeBoardRefresh = (
  current: BoardSnapshot | null,
  incoming: BoardSnapshot,
): BoardSnapshot => {
  if (
    !current
    || current.id !== incoming.id
    || current.revision !== incoming.revision
  ) {
    return incoming;
  }

  // With the same revision the product state is unchanged. Keep any pages the
  // client already traversed instead of replacing them with snapshot heads.
  return current;
};

export const mergeBoardItemsPage = (
  current: BoardSnapshot | null,
  page: BoardItemsPage,
  requestedCursor: string,
): BoardSnapshot | null => {
  if (!current || current.revision !== page.revision) {
    return current;
  }

  const targetColumn = current.columns.find((column) => column.id === page.columnId);
  if (!targetColumn || targetColumn.nextCursor !== requestedCursor) {
    return current;
  }

  const items = mergeItems(targetColumn.items, page.items);
  return {
    ...current,
    columns: current.columns.map((column) => {
      if (column.id !== page.columnId) {
        return column;
      }

      return {
        ...column,
        items,
        totalCount: Math.max(page.totalCount, items.length),
        nextCursor: items.length >= page.totalCount ? null : page.nextCursor,
      };
    }),
  };
};

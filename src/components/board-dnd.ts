import type {
  ActionItemPlacement,
  BoardSnapshot,
  ColumnPlacement,
  ItemPlacement,
  ItemRef,
} from "../lib/services/content-types.ts";

export type BoardDndId =
  | { namespace: "COLUMN"; columnId: string }
  | { namespace: "ITEM"; item: ItemRef }
  | { namespace: "COLUMN_DROP"; columnId: string }
  | { namespace: "ACTION"; actionItemId: string };

export type BoardDndMove =
  | { namespace: "COLUMN"; columnId: string; targetIndex: number }
  | {
      namespace: "ITEM";
      item: ItemRef;
      targetColumnId: string;
      targetIndex: number;
    }
  | { namespace: "ACTION"; actionItemId: string; targetIndex: number };

const assertIdSegment = (value: string, name: string): void => {
  if (value.length === 0 || value.includes(":")) {
    throw new Error(`${name} должен быть непустым DnD ID без двоеточий`);
  }
};

export const boardDndIds = {
  column(columnId: string): string {
    assertIdSegment(columnId, "columnId");
    return `COLUMN:${columnId}`;
  },
  item(item: ItemRef): string {
    assertIdSegment(item.id, "item.id");
    return `ITEM:${item.kind}:${item.id}`;
  },
  columnDrop(columnId: string): string {
    assertIdSegment(columnId, "columnId");
    return `COLUMN_DROP:${columnId}`;
  },
  action(actionItemId: string): string {
    assertIdSegment(actionItemId, "actionItemId");
    return `ACTION:${actionItemId}`;
  },
} as const;

export const parseBoardDndId = (value: string | number): BoardDndId | null => {
  if (typeof value !== "string") {
    return null;
  }

  const segments = value.split(":");
  if (segments.length === 2 && segments[1].length > 0) {
    const id = segments[1];
    if (segments[0] === "COLUMN") {
      return { namespace: "COLUMN", columnId: id };
    }
    if (segments[0] === "COLUMN_DROP") {
      return { namespace: "COLUMN_DROP", columnId: id };
    }
    if (segments[0] === "ACTION") {
      return { namespace: "ACTION", actionItemId: id };
    }
  }

  if (
    segments.length === 3
    && segments[0] === "ITEM"
    && (segments[1] === "CARD" || segments[1] === "GROUP")
    && segments[2].length > 0
  ) {
    return {
      namespace: "ITEM",
      item: { kind: segments[1], id: segments[2] },
    };
  }

  return null;
};

const assertFinalIndex = (index: number, length: number): void => {
  if (!Number.isInteger(index) || index < 0 || index >= length) {
    throw new RangeError("Перемещённый элемент отсутствует в итоговой последовательности");
  }
};

const buildPlacementAroundFinalIndex = <T>(
  finalSequence: readonly T[],
  finalIndex: number,
): { before: T | null; after: T | null } => {
  assertFinalIndex(finalIndex, finalSequence.length);
  return {
    before: finalIndex === 0 ? null : finalSequence[finalIndex - 1],
    after: finalIndex === finalSequence.length - 1
      ? null
      : finalSequence[finalIndex + 1],
  };
};

const sameItem = (left: ItemRef, right: ItemRef): boolean =>
  left.kind === right.kind && left.id === right.id;

export const buildItemPlacement = (
  finalItems: readonly ItemRef[],
  movedItem: ItemRef,
): ItemPlacement => {
  const finalIndex = finalItems.findIndex((item) => sameItem(item, movedItem));
  const placement = buildPlacementAroundFinalIndex(finalItems, finalIndex);
  return {
    before: placement.before
      ? { kind: placement.before.kind, id: placement.before.id }
      : null,
    after: placement.after
      ? { kind: placement.after.kind, id: placement.after.id }
      : null,
  };
};

export const buildColumnPlacement = (
  finalColumnIds: readonly string[],
  movedColumnId: string,
): ColumnPlacement => {
  const finalIndex = finalColumnIds.indexOf(movedColumnId);
  const placement = buildPlacementAroundFinalIndex(finalColumnIds, finalIndex);
  return {
    beforeColumnId: placement.before,
    afterColumnId: placement.after,
  };
};

export const buildActionItemPlacement = (
  finalActionItemIds: readonly string[],
  movedActionItemId: string,
): ActionItemPlacement => {
  const finalIndex = finalActionItemIds.indexOf(movedActionItemId);
  const placement = buildPlacementAroundFinalIndex(finalActionItemIds, finalIndex);
  return {
    beforeActionItemId: placement.before,
    afterActionItemId: placement.after,
  };
};

const insertAt = <T>(items: readonly T[], item: T, targetIndex: number): T[] => {
  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > items.length) {
    throw new RangeError("targetIndex выходит за границы итоговой последовательности");
  }
  return [
    ...items.slice(0, targetIndex),
    item,
    ...items.slice(targetIndex),
  ];
};

const moveColumn = (
  board: BoardSnapshot,
  columnId: string,
  targetIndex: number,
): BoardSnapshot => {
  const column = board.columns.find((candidate) => candidate.id === columnId);
  if (!column) {
    throw new Error("Перемещаемая колонка не найдена");
  }
  const remaining = board.columns.filter((candidate) => candidate.id !== columnId);
  return {
    ...board,
    columns: insertAt(remaining, column, targetIndex),
  };
};

const moveItem = (
  board: BoardSnapshot,
  itemRef: ItemRef,
  targetColumnId: string,
  targetIndex: number,
): BoardSnapshot => {
  const sourceColumn = board.columns.find((column) =>
    column.items.some((item) => sameItem(item, itemRef)));
  if (!sourceColumn) {
    throw new Error("Перемещаемый элемент доски не найден");
  }
  const targetColumn = board.columns.find((column) => column.id === targetColumnId);
  if (!targetColumn) {
    throw new Error("Целевая колонка не найдена");
  }

  const item = sourceColumn.items.find((candidate) => sameItem(candidate, itemRef));
  if (!item) {
    throw new Error("Перемещаемый элемент доски не найден");
  }
  const movedItem = item.kind === "CARD"
    ? { ...item, columnId: targetColumnId }
    : {
        ...item,
        columnId: targetColumnId,
        cards: item.cards.map((card) => ({ ...card, columnId: targetColumnId })),
      };

  if (sourceColumn.id === targetColumn.id) {
    const remaining = sourceColumn.items.filter((candidate) => !sameItem(candidate, itemRef));
    const items = insertAt(remaining, movedItem, targetIndex);
    return {
      ...board,
      columns: board.columns.map((column) =>
        column.id === sourceColumn.id ? { ...column, items } : column),
    };
  }

  const sourceItems = sourceColumn.items.filter((candidate) => !sameItem(candidate, itemRef));
  const targetItems = insertAt(targetColumn.items, movedItem, targetIndex);
  return {
    ...board,
    columns: board.columns.map((column) => {
      if (column.id === sourceColumn.id) {
        return {
          ...column,
          items: sourceItems,
          totalCount: Math.max(0, column.totalCount - 1),
        };
      }
      if (column.id === targetColumn.id) {
        return {
          ...column,
          items: targetItems,
          totalCount: column.totalCount + 1,
        };
      }
      return column;
    }),
  };
};

const moveActionItem = (
  board: BoardSnapshot,
  actionItemId: string,
  targetIndex: number,
): BoardSnapshot => {
  const actionItem = board.actionItems.find((item) => item.id === actionItemId);
  if (!actionItem) {
    throw new Error("Перемещаемое решение не найдено");
  }
  const remaining = board.actionItems.filter((item) => item.id !== actionItemId);
  return {
    ...board,
    actionItems: insertAt(remaining, actionItem, targetIndex),
  };
};

export const moveBoardSnapshot = (
  board: BoardSnapshot,
  move: BoardDndMove,
): BoardSnapshot => {
  if (move.namespace === "COLUMN") {
    return moveColumn(board, move.columnId, move.targetIndex);
  }
  if (move.namespace === "ITEM") {
    return moveItem(
      board,
      move.item,
      move.targetColumnId,
      move.targetIndex,
    );
  }
  return moveActionItem(board, move.actionItemId, move.targetIndex);
};

import { ApiError } from "../errors/api-error-base.ts";
import type { ActionItemPlacement, ActionItemView } from "./content-types.ts";
import {
  MAX_BOARD_ACTION_ITEMS,
  POSITION_STEP,
  incrementBoardRevision,
  lockBoardForMutation,
  positionForInsertion,
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

type ActionItemRow = {
  id: string;
  boardId: string;
  text: string;
  assignee: string | null;
  completed: boolean;
  position: number;
  sourceCardId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreateActionItemPayload =
  | { source: "manual"; text: string; assignee?: string | null }
  | { source: "card"; sourceCardId: string; assignee?: string | null };

const actionItemNotFound = () => new ApiError(
  404,
  "ACTION_ITEM_NOT_FOUND",
  "Action item не найден.",
);

const cardNotFound = () => new ApiError(404, "CARD_NOT_FOUND", "Карточка не найдена.");

const requireActionPlacementResources = (
  items: readonly ActionItemRow[],
  placement: ActionItemPlacement,
): void => {
  const actionItemIds = new Set(items.map((item) => item.id));
  if (
    (
      placement.beforeActionItemId !== null
      && !actionItemIds.has(placement.beforeActionItemId)
    )
    || (
      placement.afterActionItemId !== null
      && !actionItemIds.has(placement.afterActionItemId)
    )
  ) {
    throw actionItemNotFound();
  }
};

const normalizeText = (text: string): string => {
  const normalized = text.trim();
  if (normalized.length < 1 || normalized.length > 1000) {
    throw new RangeError("action item text must contain between 1 and 1000 characters");
  }
  return normalized;
};

const normalizeAssignee = (assignee: string | null | undefined): string | null => {
  if (assignee === null || assignee === undefined) {
    return null;
  }
  const normalized = assignee.trim();
  if (normalized.length < 1 || normalized.length > 120) {
    throw new RangeError("assignee must contain between 1 and 120 characters");
  }
  return normalized;
};

const serializeActionItem = (actionItem: ActionItemRow): ActionItemView => ({
  id: actionItem.id,
  text: actionItem.text,
  assignee: actionItem.assignee,
  completed: actionItem.completed,
  position: actionItem.position,
  sourceCardId: actionItem.sourceCardId,
  createdAt: actionItem.createdAt.toISOString(),
  updatedAt: actionItem.updatedAt.toISOString(),
});

const listActionItems = (tx: ContentTransaction, boardId: string) => tx.actionItem.findMany({
  where: { boardId },
  orderBy: [{ position: "asc" }, { id: "asc" }],
});

const rebalanceActionItems = async (
  tx: ContentTransaction,
  items: readonly ActionItemRow[],
): Promise<ActionItemRow[]> => {
  const result: ActionItemRow[] = [];
  for (const [index, item] of items.entries()) {
    const position = (index + 1) * POSITION_STEP;
    if (item.position !== position) {
      await tx.actionItem.update({ where: { id: item.id }, data: { position } });
    }
    result.push({ ...item, position });
  }
  return result;
};

const resolveActionPosition = async (
  tx: ContentTransaction,
  board: LockedBoard,
  items: readonly ActionItemRow[],
  placement: ActionItemPlacement,
): Promise<number> => {
  const insertionIndex = resolveIdPlacementIndex(
    items.map((item) => item.id),
    placement.beforeActionItemId,
    placement.afterActionItemId,
  );
  if (insertionIndex === null) {
    throw stalePlacement(board.revision);
  }
  let position = positionForInsertion(items.map((item) => item.position), insertionIndex);
  if (position !== null) {
    return position;
  }
  const rebalanced = await rebalanceActionItems(tx, items);
  position = positionForInsertion(rebalanced.map((item) => item.position), insertionIndex);
  if (position === null) {
    throw new Error("Could not allocate an action-item position after rebalance");
  }
  return position;
};

export const createActionItem = async (
  boardId: string,
  visitorPayload: string,
  payload: CreateActionItemPayload,
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  const count = await tx.actionItem.count({ where: { boardId } });
  if (count >= MAX_BOARD_ACTION_ITEMS) {
    throw new ApiError(
      422,
      "BOARD_ACTION_ITEM_LIMIT_REACHED",
      `На доске может быть не более ${MAX_BOARD_ACTION_ITEMS} action items.`,
      { limit: MAX_BOARD_ACTION_ITEMS },
    );
  }

  let text: string;
  let sourceCardId: string | null;
  if (payload.source === "card") {
    const sourceCard = await tx.card.findFirst({
      where: { id: payload.sourceCardId, boardId },
      select: { id: true, text: true },
    });
    if (!sourceCard) {
      throw cardNotFound();
    }
    text = normalizeText(sourceCard.text);
    sourceCardId = sourceCard.id;
  } else {
    text = normalizeText(payload.text);
    sourceCardId = null;
  }

  let items = await listActionItems(tx, boardId);
  let position = positionForInsertion(items.map((item) => item.position), 0);
  if (position === null) {
    items = await rebalanceActionItems(tx, items);
    position = positionForInsertion(items.map((item) => item.position), 0);
  }
  if (position === null) {
    throw new Error("Could not allocate a head action-item position");
  }
  const actionItem = await tx.actionItem.create({
    data: {
      boardId,
      text,
      assignee: normalizeAssignee(payload.assignee),
      completed: false,
      position,
      sourceCardId,
    },
  });
  const revision = await incrementBoardRevision(tx, boardId, "action.created");
  return { revision: serializeRevision(revision), actionItem: serializeActionItem(actionItem) };
});

export const updateActionItem = async (
  boardId: string,
  actionItemId: string,
  visitorPayload: string,
  patch: { text?: string; assignee?: string | null; completed?: boolean },
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  const actionItem = await tx.actionItem.findFirst({
    where: { id: actionItemId, boardId },
  });
  if (!actionItem) {
    throw actionItemNotFound();
  }
  const text = patch.text === undefined ? actionItem.text : normalizeText(patch.text);
  const assignee = patch.assignee === undefined
    ? actionItem.assignee
    : normalizeAssignee(patch.assignee);
  const completed = patch.completed ?? actionItem.completed;
  if (
    text === actionItem.text
    && assignee === actionItem.assignee
    && completed === actionItem.completed
  ) {
    return {
      revision: serializeRevision(board.revision),
      actionItem: serializeActionItem(actionItem),
    };
  }
  const updated = await tx.actionItem.update({
    where: { id: actionItem.id },
    data: { text, assignee, completed, updatedAt: new Date() },
  });
  const revision = await incrementBoardRevision(tx, boardId, "action.updated");
  return { revision: serializeRevision(revision), actionItem: serializeActionItem(updated) };
});

export const moveActionItem = async (
  boardId: string,
  actionItemId: string,
  visitorPayload: string,
  payload: { placement: ActionItemPlacement; expectedRevision: string },
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  requireExpectedRevision(board, payload.expectedRevision);
  const items = await listActionItems(tx, boardId);
  const actionItem = items.find((item) => item.id === actionItemId);
  if (!actionItem) {
    throw actionItemNotFound();
  }
  requireActionPlacementResources(items, payload.placement);
  const remaining = items.filter((item) => item.id !== actionItem.id);
  const requestedIndex = resolveIdPlacementIndex(
    remaining.map((item) => item.id),
    payload.placement.beforeActionItemId,
    payload.placement.afterActionItemId,
  );
  if (requestedIndex === null) {
    throw stalePlacement(board.revision);
  }
  if (requestedIndex === items.indexOf(actionItem)) {
    return {
      revision: serializeRevision(board.revision),
      actionItem: serializeActionItem(actionItem),
    };
  }
  const position = await resolveActionPosition(tx, board, remaining, payload.placement);
  const updated = await tx.actionItem.update({
    where: { id: actionItem.id },
    data: { position, updatedAt: new Date() },
  });
  const revision = await incrementBoardRevision(tx, boardId, "action.moved");
  return { revision: serializeRevision(revision), actionItem: serializeActionItem(updated) };
});

export const deleteActionItem = async (
  boardId: string,
  actionItemId: string,
  visitorPayload: string,
  expectedRevision: string,
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(board);
  requireOwner(access);
  requireExpectedRevision(board, expectedRevision);
  const deleted = await tx.actionItem.deleteMany({ where: { id: actionItemId, boardId } });
  if (deleted.count === 0) {
    throw actionItemNotFound();
  }
  const revision = await incrementBoardRevision(tx, boardId, "action.deleted");
  return { revision: serializeRevision(revision) };
});

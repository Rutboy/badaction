import { Prisma } from "@prisma/client";
import { ApiError } from "../errors/api-error-base.ts";
import type {
  CardView,
  GroupView,
  ItemPlacement,
  VisitorIdentity,
} from "./content-types.ts";
import {
  MAX_GROUP_CARDS,
  MAX_POSITION,
  POSITION_STEP,
  incrementBoardRevision,
  lockBoardForMutation,
  requireCardsEnabled,
  requireContentVisitorIdentity,
  requireExpectedRevision,
  requireOwner,
  requireWritableBoard,
  resolveItemPlacementIndex,
  serializeRevision,
  stalePlacement,
  withContentTransaction,
  type BoardMutationContext,
  type ContentTransaction,
} from "./content-service-helpers.ts";
import {
  allocateTopLevelPosition,
  listTopLevelItems,
  setTopLevelPosition,
  type TopLevelItemRow,
} from "./top-level-order.ts";
import { moveVotesBetweenColumns } from "./vote-move-service.ts";

const GROUP_CARD_SELECT = {
  id: true,
  boardId: true,
  columnId: true,
  text: true,
  author: true,
  createdByMembershipId: true,
  position: true,
  groupId: true,
  groupPosition: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { votes: true } },
} satisfies Prisma.CardSelect;

const GROUP_SELECT = {
  id: true,
  boardId: true,
  columnId: true,
  position: true,
  primaryCardId: true,
  title: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CardGroupSelect;

type GroupCardRow = Prisma.CardGetPayload<{ select: typeof GROUP_CARD_SELECT }>;
type GroupRow = Prisma.CardGroupGetPayload<{ select: typeof GROUP_SELECT }>;

const groupNotFound = () => new ApiError(404, "GROUP_NOT_FOUND", "Group not found.");
const cardNotFound = () => new ApiError(404, "CARD_NOT_FOUND", "Card not found.");
const columnNotFound = () => new ApiError(404, "COLUMN_NOT_FOUND", "Column not found.");

const requireItemPlacementResources = (
  items: readonly { id: string; kind: "CARD" | "GROUP" }[],
  placement: ItemPlacement,
): void => {
  for (const reference of [placement.before, placement.after]) {
    if (
      reference !== null
      && !items.some((item) => item.id === reference.id && item.kind === reference.kind)
    ) {
      throw reference.kind === "CARD" ? cardNotFound() : groupNotFound();
    }
  }
};

const normalizeGroupTitle = (title: string | null | undefined): string | null => {
  if (title === null || title === undefined) {
    return null;
  }
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 120) {
    throw new RangeError("group title must contain between 1 and 120 characters");
  }
  return normalized;
};

const serializeGroupCard = ({
  card,
  context,
  viewerHasVoted,
  grouped,
}: {
  card: GroupCardRow;
  context: BoardMutationContext;
  viewerHasVoted: boolean;
  grouped: boolean;
}): CardView => {
  const owned = context.access.role === "OWNER"
    || card.createdByMembershipId === context.access.membershipId;
  return {
    kind: "CARD",
    id: card.id,
    columnId: card.columnId,
    text: card.text,
    author: card.author,
    position: grouped ? (card.groupPosition as number) : card.position,
    voteCount: card._count.votes,
    viewerHasVoted,
    canEdit: !context.board.readOnly && context.board.cardsEnabled && owned,
    canDelete: !context.board.readOnly && context.board.cardsEnabled && owned,
    canMove: !grouped && !context.board.readOnly && context.board.cardsEnabled && owned,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
};

const loadViewerVoteIds = async (
  tx: ContentTransaction,
  cardIds: readonly string[],
  visitorIdentity: VisitorIdentity,
): Promise<Set<string>> => {
  if (cardIds.length === 0) {
    return new Set();
  }
  const votes = await tx.vote.findMany({
    where: { cardId: { in: [...cardIds] }, visitorToken: visitorIdentity },
    select: { cardId: true },
  });
  return new Set(votes.map((vote) => vote.cardId));
};

const serializeGroupView = async (
  tx: ContentTransaction,
  group: GroupRow,
  context: BoardMutationContext,
  visitorIdentity: VisitorIdentity,
): Promise<GroupView> => {
  const cards = await tx.card.findMany({
    where: { boardId: group.boardId, groupId: group.id },
    orderBy: [{ groupPosition: "asc" }, { id: "asc" }],
    select: GROUP_CARD_SELECT,
  });
  const viewerVotes = await loadViewerVoteIds(
    tx,
    cards.map((card) => card.id),
    visitorIdentity,
  );
  return {
    kind: "GROUP",
    id: group.id,
    columnId: group.columnId,
    position: group.position,
    title: group.title,
    primaryCardId: group.primaryCardId,
    voteCount: cards.reduce((sum, card) => sum + card._count.votes, 0),
    viewerHasVoted: viewerVotes.has(group.primaryCardId),
    canMove: context.access.role === "OWNER"
      && !context.board.readOnly
      && context.board.cardsEnabled,
    canUngroup: context.access.role === "OWNER"
      && !context.board.readOnly
      && context.board.cardsEnabled,
    cards: cards.map((card) => serializeGroupCard({
      card,
      context,
      viewerHasVoted: viewerVotes.has(card.id),
      grouped: true,
    })),
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString(),
  };
};

export const createCardGroup = async (
  boardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  payload: {
    columnId: string;
    cardIds: readonly string[];
    primaryCardId: string;
    title?: string | null;
    expectedRevision: string;
  },
) => withContentTransaction(async (tx) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireOwner(context.access);
  requireCardsEnabled(context.board);
  requireExpectedRevision(context.board, payload.expectedRevision);
  const cardIds = [...new Set(payload.cardIds)];
  if (cardIds.length < 2 || cardIds.length > MAX_GROUP_CARDS || cardIds.length !== payload.cardIds.length) {
    throw new RangeError(`cardIds must contain between 2 and ${MAX_GROUP_CARDS} unique IDs`);
  }
  if (!cardIds.includes(payload.primaryCardId)) {
    throw new RangeError("primaryCardId must be present in cardIds");
  }
  const column = await tx.boardColumn.findFirst({
    where: { id: payload.columnId, boardId },
    select: { id: true },
  });
  if (!column) {
    throw columnNotFound();
  }
  const cards = await tx.card.findMany({
    where: { boardId, columnId: column.id, id: { in: cardIds } },
    select: GROUP_CARD_SELECT,
  });
  if (cards.length !== cardIds.length) {
    throw cardNotFound();
  }
  if (cards.some((card) => card.groupId !== null)) {
    throw new ApiError(409, "CARD_GROUPED", "One or more cards already belong to a group.");
  }
  cards.sort((left, right) => left.position - right.position
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const now = new Date();
  await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
  const group = await tx.cardGroup.create({
    data: {
      boardId,
      columnId: column.id,
      position: cards[0].position,
      primaryCardId: payload.primaryCardId,
      title: normalizeGroupTitle(payload.title),
      createdAt: now,
      updatedAt: now,
    },
    select: GROUP_SELECT,
  });
  for (const [index, card] of cards.entries()) {
    await tx.card.update({
      where: { id: card.id },
      data: {
        groupId: group.id,
        groupPosition: (index + 1) * POSITION_STEP,
        updatedAt: now,
      },
    });
  }
  const revision = await incrementBoardRevision(tx, boardId, "group.created");
  return {
    revision: serializeRevision(revision),
    group: await serializeGroupView(tx, group, context, visitorIdentity),
  };
});

export const updateCardGroup = async (
  boardId: string,
  groupId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  patch: { title?: string | null; primaryCardId?: string; expectedRevision?: string },
) => withContentTransaction(async (tx) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireOwner(context.access);
  requireCardsEnabled(context.board);
  const group = await tx.cardGroup.findFirst({
    where: { id: groupId, boardId },
    select: GROUP_SELECT,
  });
  if (!group) {
    throw groupNotFound();
  }
  const title = patch.title === undefined ? group.title : normalizeGroupTitle(patch.title);
  const primaryCardId = patch.primaryCardId ?? group.primaryCardId;
  if (patch.primaryCardId !== undefined) {
    if (patch.expectedRevision === undefined) {
      throw new RangeError("expectedRevision is required when primaryCardId is present");
    }
    requireExpectedRevision(context.board, patch.expectedRevision);
    const primary = await tx.card.findFirst({
      where: { id: patch.primaryCardId, boardId, groupId: group.id },
      select: { id: true },
    });
    if (!primary) {
      throw cardNotFound();
    }
  }
  if (title === group.title && primaryCardId === group.primaryCardId) {
    return {
      revision: serializeRevision(context.board.revision),
      group: await serializeGroupView(tx, group, context, visitorIdentity),
    };
  }
  const updated = await tx.cardGroup.update({
    where: { id: group.id },
    data: { title, primaryCardId, updatedAt: new Date() },
    select: GROUP_SELECT,
  });
  const revision = await incrementBoardRevision(tx, boardId, "group.updated");
  return {
    revision: serializeRevision(revision),
    group: await serializeGroupView(tx, updated, context, visitorIdentity),
  };
});

export const moveCardGroup = async (
  boardId: string,
  groupId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  payload: {
    targetColumnId: string;
    placement: ItemPlacement;
    expectedRevision: string;
  },
) => withContentTransaction(async (tx) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireOwner(context.access);
  requireCardsEnabled(context.board);
  requireExpectedRevision(context.board, payload.expectedRevision);
  const group = await tx.cardGroup.findFirst({
    where: { id: groupId, boardId },
    select: GROUP_SELECT,
  });
  if (!group) {
    throw groupNotFound();
  }
  const targetColumn = await tx.boardColumn.findFirst({
    where: { id: payload.targetColumnId, boardId },
    select: { id: true, voteLimit: true },
  });
  if (!targetColumn) {
    throw columnNotFound();
  }
  const allTargetItems = await listTopLevelItems(tx, boardId, targetColumn.id);
  requireItemPlacementResources(allTargetItems, payload.placement);
  const targetItems = allTargetItems
    .filter((item) => item.kind !== "GROUP" || item.id !== group.id);
  if (targetColumn.id === group.columnId) {
    const currentIndex = allTargetItems.findIndex((item) =>
      item.kind === "GROUP" && item.id === group.id);
    const requestedIndex = resolveItemPlacementIndex(
      targetItems,
      payload.placement.before,
      payload.placement.after,
    );
    if (requestedIndex === null) {
      throw stalePlacement(context.board.revision);
    }
    if (requestedIndex === currentIndex) {
      return {
        revision: serializeRevision(context.board.revision),
        group: await serializeGroupView(tx, group, context, visitorIdentity),
      };
    }
  }
  const position = await allocateTopLevelPosition(
    tx,
    context.board,
    targetItems,
    payload.placement,
  );
  const cards = await tx.card.findMany({
    where: { boardId, groupId: group.id },
    select: { id: true },
  });
  await moveVotesBetweenColumns({
    tx,
    boardId,
    cardIds: cards.map((card) => card.id),
    sourceColumnId: group.columnId,
    targetColumnId: targetColumn.id,
    targetVoteLimit: targetColumn.voteLimit,
  });
  const now = new Date();
  await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
  await tx.card.updateMany({
    where: { boardId, groupId: group.id },
    data: { columnId: targetColumn.id, updatedAt: now },
  });
  const updated = await tx.cardGroup.update({
    where: { id: group.id },
    data: { columnId: targetColumn.id, position, updatedAt: now },
    select: GROUP_SELECT,
  });
  const revision = await incrementBoardRevision(tx, boardId, "group.moved");
  return {
    revision: serializeRevision(revision),
    group: await serializeGroupView(tx, updated, context, visitorIdentity),
  };
});

const allocateUngroupPositions = async (
  tx: ContentTransaction,
  boardId: string,
  group: GroupRow,
  cardCount: number,
): Promise<number[]> => {
  const items = await listTopLevelItems(tx, boardId, group.columnId);
  const groupIndex = items.findIndex((item) => item.kind === "GROUP" && item.id === group.id);
  if (groupIndex < 0) {
    throw new Error("Group is missing from the top-level order");
  }
  const nextPosition = items[groupIndex + 1]?.position ?? null;
  if (nextPosition === null) {
    if (group.position + (cardCount - 1) * POSITION_STEP <= MAX_POSITION) {
      return Array.from({ length: cardCount }, (_, index) => group.position + index * POSITION_STEP);
    }
  } else if (nextPosition - group.position > cardCount - 1) {
    const gap = nextPosition - group.position;
    return Array.from(
      { length: cardCount },
      (_, index) => group.position + Math.floor((gap * index) / cardCount),
    );
  }

  const withoutGroup = items.filter((_, index) => index !== groupIndex);
  const placeholders: TopLevelItemRow[] = Array.from({ length: cardCount }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    kind: "CARD" as const,
    position: group.position,
  }));
  const finalItems = [
    ...withoutGroup.slice(0, groupIndex),
    ...placeholders,
    ...withoutGroup.slice(groupIndex),
  ];
  for (const [index, item] of finalItems.entries()) {
    if (!placeholders.includes(item)) {
      await setTopLevelPosition(tx, item, (index + 1) * POSITION_STEP);
    }
  }
  return placeholders.map((placeholder) => {
    const index = finalItems.indexOf(placeholder);
    return (index + 1) * POSITION_STEP;
  });
};

export const ungroupCardGroup = async (
  boardId: string,
  groupId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  expectedRevision: string,
) => withContentTransaction(async (tx) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireOwner(context.access);
  requireCardsEnabled(context.board);
  requireExpectedRevision(context.board, expectedRevision);
  const group = await tx.cardGroup.findFirst({
    where: { id: groupId, boardId },
    select: GROUP_SELECT,
  });
  if (!group) {
    throw groupNotFound();
  }
  const cards = await tx.card.findMany({
    where: { boardId, groupId: group.id },
    orderBy: [{ groupPosition: "asc" }, { id: "asc" }],
    select: GROUP_CARD_SELECT,
  });
  if (cards.length < 2) {
    throw new Error("Persisted group contains fewer than two cards");
  }
  const positions = await allocateUngroupPositions(tx, boardId, group, cards.length);
  const now = new Date();
  await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
  for (const [index, card] of cards.entries()) {
    await tx.card.update({
      where: { id: card.id },
      data: {
        groupId: null,
        groupPosition: null,
        position: positions[index],
        updatedAt: now,
      },
    });
  }
  await tx.cardGroup.delete({ where: { id: group.id } });
  const refreshed = await tx.card.findMany({
    where: { id: { in: cards.map((card) => card.id) } },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: GROUP_CARD_SELECT,
  });
  const viewerVotes = await loadViewerVoteIds(
    tx,
    refreshed.map((card) => card.id),
    visitorIdentity,
  );
  const revision = await incrementBoardRevision(tx, boardId, "group.deleted");
  return {
    revision: serializeRevision(revision),
    items: refreshed.map((card) => serializeGroupCard({
      card,
      context,
      viewerHasVoted: viewerVotes.has(card.id),
      grouped: false,
    })),
  };
});

import { Prisma } from "@prisma/client";
import { getBoardCardLimit } from "../config/limits.ts";
import { ApiError } from "../errors/api-error-base.ts";
import type { CardView, ItemPlacement, VisitorIdentity } from "./content-types.ts";
import {
  incrementBoardRevision,
  lockBoardForMutation,
  requireCardsEnabled,
  requireContentVisitorIdentity,
  requireExpectedRevision,
  requireOwner,
  requireVotingEnabled,
  requireWritableBoard,
  resolveItemPlacementIndex,
  serializeRevision,
  stalePlacement,
  withContentTransaction,
  type BoardMutationContext,
  type ContentTransaction,
} from "./content-service-helpers.ts";
import {
  allocateHeadPosition,
  allocateTopLevelPosition,
  listTopLevelItems,
  materializeTopLevelItemMove,
} from "./top-level-order.ts";
import { moveVotesBetweenColumns } from "./vote-move-service.ts";

const CARD_SELECT = {
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

type CardRow = Prisma.CardGetPayload<{ select: typeof CARD_SELECT }>;

const cardNotFound = () => new ApiError(404, "CARD_NOT_FOUND", "Card not found.");
const columnNotFound = () => new ApiError(404, "COLUMN_NOT_FOUND", "Column not found.");
const groupNotFound = () => new ApiError(404, "GROUP_NOT_FOUND", "Group not found.");

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

const normalizeCardText = (text: string): string => {
  const normalized = text.trim();
  if (normalized.length < 1 || normalized.length > 1000) {
    throw new RangeError("card text must contain between 1 and 1000 characters");
  }
  return normalized;
};

const normalizeAuthor = (author: string | null | undefined): string | null => {
  if (author === null || author === undefined) {
    return null;
  }
  const normalized = author.trim();
  if (normalized.length < 1 || normalized.length > 120) {
    throw new RangeError("author must contain between 1 and 120 characters");
  }
  return normalized;
};

const assertCardOwner = (context: BoardMutationContext, card: CardRow): void => {
  if (context.access.role === "OWNER") {
    return;
  }
  if (card.createdByMembershipId !== context.access.membershipId) {
    throw new ApiError(
      403,
      "CARD_OWNER_REQUIRED",
      "You can only change cards created with your current access.",
    );
  }
};

const serializeCardView = ({
  card,
  context,
  viewerHasVoted,
}: {
  card: CardRow;
  context: BoardMutationContext;
  viewerHasVoted: boolean;
}): CardView => {
  const owned = context.access.role === "OWNER"
    || card.createdByMembershipId === context.access.membershipId;
  return {
    kind: "CARD",
    id: card.id,
    columnId: card.columnId,
    text: card.text,
    author: card.author,
    position: card.groupPosition ?? card.position,
    voteCount: card._count.votes,
    viewerHasVoted,
    canEdit: !context.board.readOnly && context.board.cardsEnabled && owned,
    canDelete: !context.board.readOnly && context.board.cardsEnabled && owned,
    canMove: !context.board.readOnly
      && context.board.cardsEnabled
      && owned
      && card.groupId === null,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
};

const getCardViewerVote = (
  tx: ContentTransaction,
  cardId: string,
  visitorIdentity: VisitorIdentity,
) => {
  return tx.vote.findUnique({
    where: { cardId_visitorToken: { cardId, visitorToken: visitorIdentity } },
    select: { id: true },
  });
};

export const createTargetCard = async (
  boardId: string,
  visitorPayload: string,
  payload: { columnId: string; text: string; author?: string | null },
) => withContentTransaction(async (tx) => {
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireCardsEnabled(context.board);
  const column = await tx.boardColumn.findFirst({
    where: { id: payload.columnId, boardId },
    select: { id: true },
  });
  if (!column) {
    throw columnNotFound();
  }

  const cardLimit = getBoardCardLimit();
  const cardCount = await tx.card.count({ where: { boardId } });
  if (cardCount >= cardLimit) {
    throw new ApiError(
      422,
      "BOARD_CARD_LIMIT_REACHED",
      `This board has reached its limit of ${cardLimit} cards.`,
      { limit: cardLimit },
    );
  }
  const items = await listTopLevelItems(tx, boardId, column.id);
  const position = await allocateHeadPosition(tx, items);
  const card = await tx.card.create({
    data: {
      boardId,
      columnId: column.id,
      text: normalizeCardText(payload.text),
      author: normalizeAuthor(payload.author),
      createdByMembershipId: context.access.membershipId,
      position,
    },
    select: CARD_SELECT,
  });
  const revision = await incrementBoardRevision(tx, boardId, "card.created");
  return {
    revision: serializeRevision(revision),
    card: serializeCardView({ card, context, viewerHasVoted: false }),
  };
});

export const updateTargetCard = async (
  boardId: string,
  cardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  patch: { text?: string; author?: string | null },
) => withContentTransaction(async (tx) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireCardsEnabled(context.board);
  const card = await tx.card.findFirst({ where: { id: cardId, boardId }, select: CARD_SELECT });
  if (!card) {
    throw cardNotFound();
  }
  assertCardOwner(context, card);
  const text = patch.text === undefined ? card.text : normalizeCardText(patch.text);
  const author = patch.author === undefined ? card.author : normalizeAuthor(patch.author);
  const viewerVote = await getCardViewerVote(tx, cardId, visitorIdentity);
  if (text === card.text && author === card.author) {
    return {
      revision: serializeRevision(context.board.revision),
      card: serializeCardView({ card, context, viewerHasVoted: viewerVote !== null }),
    };
  }
  const updated = await tx.card.update({
    where: { id: card.id },
    data: { text, author, updatedAt: new Date() },
    select: CARD_SELECT,
  });
  const revision = await incrementBoardRevision(tx, boardId, "card.updated");
  return {
    revision: serializeRevision(revision),
    card: serializeCardView({ card: updated, context, viewerHasVoted: viewerVote !== null }),
  };
});

export const moveTargetCard = async (
  boardId: string,
  cardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  payload: {
    targetColumnId: string;
    placement: ItemPlacement;
    voteSortedColumnIds?: readonly string[];
    expectedRevision: string;
  },
) => withContentTransaction(async (tx) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireCardsEnabled(context.board);
  requireExpectedRevision(context.board, payload.expectedRevision);
  const card = await tx.card.findFirst({ where: { id: cardId, boardId }, select: CARD_SELECT });
  if (!card) {
    throw cardNotFound();
  }
  assertCardOwner(context, card);
  if (card.groupId !== null) {
    throw new ApiError(
      409,
      "CARD_GROUPED",
      "Ungroup the card before moving it on its own.",
    );
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
    .filter((item) => item.kind !== "CARD" || item.id !== card.id);
  const voteSortedColumnIds = payload.voteSortedColumnIds ?? [];
  let position: number;
  if (voteSortedColumnIds.length > 0) {
    await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
    position = await materializeTopLevelItemMove({
      tx,
      board: context.board,
      boardId,
      sourceColumnId: card.columnId,
      targetColumnId: targetColumn.id,
      movedItem: { kind: "CARD", id: card.id },
      placement: payload.placement,
      voteSortedColumnIds,
    });
  } else if (card.columnId === targetColumn.id) {
    const currentIndex = allTargetItems.findIndex((item) =>
      item.kind === "CARD" && item.id === card.id);
    const requestedIndex = resolveItemPlacementIndex(
      targetItems,
      payload.placement.before,
      payload.placement.after,
    );
    if (requestedIndex === null) {
      throw stalePlacement(context.board.revision);
    }
    if (requestedIndex === currentIndex) {
      const viewerVote = await getCardViewerVote(tx, cardId, visitorIdentity);
      return {
        revision: serializeRevision(context.board.revision),
        card: serializeCardView({ card, context, viewerHasVoted: viewerVote !== null }),
      };
    }
    position = await allocateTopLevelPosition(
      tx,
      context.board,
      targetItems,
      payload.placement,
    );
  } else {
    position = await allocateTopLevelPosition(
      tx,
      context.board,
      targetItems,
      payload.placement,
    );
  }
  await moveVotesBetweenColumns({
    tx,
    boardId,
    cardIds: [card.id],
    sourceColumnId: card.columnId,
    targetColumnId: targetColumn.id,
    targetVoteLimit: targetColumn.voteLimit,
  });
  const updated = await tx.card.update({
    where: { id: card.id },
    data: { columnId: targetColumn.id, position, updatedAt: new Date() },
    select: CARD_SELECT,
  });
  const viewerVote = await getCardViewerVote(tx, cardId, visitorIdentity);
  const revision = await incrementBoardRevision(tx, boardId, "card.moved");
  return {
    revision: serializeRevision(revision),
    card: serializeCardView({ card: updated, context, viewerHasVoted: viewerVote !== null }),
  };
});

export const deleteTargetCard = async (
  boardId: string,
  cardId: string,
  visitorPayload: string,
  expectedRevision: string,
) => withContentTransaction(async (tx) => {
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireCardsEnabled(context.board);
  requireExpectedRevision(context.board, expectedRevision);
  const card = await tx.card.findFirst({ where: { id: cardId, boardId }, select: CARD_SELECT });
  if (!card) {
    throw cardNotFound();
  }
  assertCardOwner(context, card);
  await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);

  if (card.groupId !== null) {
    const group = await tx.cardGroup.findFirst({
      where: { id: card.groupId, boardId, columnId: card.columnId },
      select: { id: true, primaryCardId: true, position: true },
    });
    if (!group) {
      throw new Error("Grouped card references a missing group");
    }
    const groupCards = await tx.card.findMany({
      where: { boardId, groupId: group.id },
      orderBy: [{ groupPosition: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const remaining = groupCards.filter((candidate) => candidate.id !== card.id);
    if (remaining.length === 1) {
      await tx.card.update({
        where: { id: remaining[0].id },
        data: {
          groupId: null,
          groupPosition: null,
          position: group.position,
          updatedAt: new Date(),
        },
      });
      await tx.cardGroup.delete({ where: { id: group.id } });
    } else {
      await tx.cardGroup.update({
        where: { id: group.id },
        data: {
          primaryCardId: group.primaryCardId === card.id
            ? remaining[0].id
            : group.primaryCardId,
          updatedAt: new Date(),
        },
      });
    }
  }
  await tx.card.delete({ where: { id: card.id } });
  const revision = await incrementBoardRevision(tx, boardId, "card.deleted");
  return { revision: serializeRevision(revision) };
});

const getVoteState = async (
  tx: ContentTransaction,
  boardId: string,
  cardId: string,
  columnId: string,
  visitorIdentity: VisitorIdentity,
  voteLimit: number,
  revision: bigint,
) => {
  const [voteCount, viewerVote, usedVotes] = await Promise.all([
    tx.vote.count({ where: { cardId } }),
    getCardViewerVote(tx, cardId, visitorIdentity),
    tx.vote.count({ where: { boardId, columnId, visitorToken: visitorIdentity } }),
  ]);
  return {
    revision: serializeRevision(revision),
    cardId,
    voteCount,
    viewerHasVoted: viewerVote !== null,
    remainingVotesInColumn: Math.max(0, voteLimit - usedVotes),
  };
};

type VoteForCardMode = "idempotent" | "legacy-non-idempotent";

const voteForCardInTransaction = async (
  tx: ContentTransaction,
  boardId: string,
  cardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  mode: VoteForCardMode,
) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireVotingEnabled(context.board);
  const card = await tx.card.findFirst({
    where: { id: cardId, boardId },
    select: { id: true, columnId: true },
  });
  if (!card) {
    if (mode === "legacy-non-idempotent") {
      const actionItem = await tx.actionItem.findFirst({
        where: { id: cardId, boardId },
        select: { id: true },
      });
      if (actionItem) {
        throw new ApiError(
          403,
          "LIKES_NOT_ALLOWED",
          "Voting is not available for action items.",
        );
      }
    }
    throw cardNotFound();
  }
  const column = await tx.boardColumn.findFirst({
    where: { id: card.columnId, boardId },
    select: { voteLimit: true },
  });
  if (!column) {
    throw columnNotFound();
  }
  if (column.voteLimit === 0) {
    throw new ApiError(
      422,
      "COLUMN_VOTE_LIMIT_REACHED",
      "Voting is not available in this column.",
      { columnId: card.columnId, limit: 0 },
    );
  }
  const existing = await getCardViewerVote(tx, card.id, visitorIdentity);
  if (existing) {
    if (mode === "legacy-non-idempotent") {
      throw new ApiError(
        409,
        "LIKE_ALREADY_EXISTS",
        "You have already voted for this card.",
      );
    }
    return getVoteState(
      tx,
      boardId,
      card.id,
      card.columnId,
      visitorIdentity,
      column.voteLimit,
      context.board.revision,
    );
  }
  const usedSlots = await tx.vote.findMany({
    where: { boardId, columnId: card.columnId, visitorToken: visitorIdentity },
    select: { quotaSlot: true },
  });
  const occupied = new Set(usedSlots.map((vote) => vote.quotaSlot));
  let quotaSlot: number | undefined;
  for (let candidate = 1; candidate <= column.voteLimit; candidate += 1) {
    if (!occupied.has(candidate)) {
      quotaSlot = candidate;
      break;
    }
  }
  if (quotaSlot === undefined) {
    throw new ApiError(
      422,
      "COLUMN_VOTE_LIMIT_REACHED",
      "No votes remain in this column.",
      { columnId: card.columnId, limit: column.voteLimit },
    );
  }
  await tx.vote.create({
    data: {
      boardId,
      cardId: card.id,
      columnId: card.columnId,
      visitorToken: visitorIdentity,
      quotaSlot,
    },
  });
  const revision = await incrementBoardRevision(tx, boardId, "vote.updated");
  return getVoteState(
    tx,
    boardId,
    card.id,
    card.columnId,
    visitorIdentity,
    column.voteLimit,
    revision,
  );
};

export const voteForCard = async (
  boardId: string,
  cardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
) => withContentTransaction((tx) => voteForCardInTransaction(
  tx,
  boardId,
  cardId,
  visitorPayload,
  visitorIdentity,
  "idempotent",
));

export const likeCardLegacyAdapter = async (
  boardId: string,
  cardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
) => withContentTransaction(async (tx) => {
  const result = await voteForCardInTransaction(
    tx,
    boardId,
    cardId,
    visitorPayload,
    visitorIdentity,
    "legacy-non-idempotent",
  );
  return {
    cardId: result.cardId,
    likesCount: result.voteCount,
    remainingVotesInColumn: result.remainingVotesInColumn,
  };
});

export const removeVoteFromCard = async (
  boardId: string,
  cardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
) => withContentTransaction(async (tx) => {
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireVotingEnabled(context.board);
  const card = await tx.card.findFirst({
    where: { id: cardId, boardId },
    select: { id: true, columnId: true },
  });
  if (!card) {
    throw cardNotFound();
  }
  const column = await tx.boardColumn.findFirst({
    where: { id: card.columnId, boardId },
    select: { voteLimit: true },
  });
  if (!column) {
    throw columnNotFound();
  }
  if (column.voteLimit === 0) {
    throw new ApiError(
      422,
      "COLUMN_VOTE_LIMIT_REACHED",
      "Voting is not available in this column.",
      { columnId: card.columnId, limit: 0 },
    );
  }
  const existing = await getCardViewerVote(tx, card.id, visitorIdentity);
  if (!existing) {
    return getVoteState(
      tx,
      boardId,
      card.id,
      card.columnId,
      visitorIdentity,
      column.voteLimit,
      context.board.revision,
    );
  }
  await tx.vote.delete({ where: { id: existing.id } });
  const revision = await incrementBoardRevision(tx, boardId, "vote.updated");
  return getVoteState(
    tx,
    boardId,
    card.id,
    card.columnId,
    visitorIdentity,
    column.voteLimit,
    revision,
  );
});

export const resetBoardVotes = async (
  boardId: string,
  visitorPayload: string,
  expectedRevision: string,
) => withContentTransaction(async (tx) => {
  const context = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireWritableBoard(context.board);
  requireOwner(context.access);
  requireExpectedRevision(context.board, expectedRevision);
  const deleted = await tx.vote.deleteMany({ where: { boardId } });
  if (deleted.count === 0) {
    return { revision: serializeRevision(context.board.revision), deletedVotes: 0 };
  }
  const revision = await incrementBoardRevision(tx, boardId, "votes.reset");
  return { revision: serializeRevision(revision), deletedVotes: deleted.count };
});

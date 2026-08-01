import { Prisma } from "@prisma/client";
import {
  requireActiveBoardMember,
  type BoardAccessContext,
} from "../access/acl-service.ts";
import { contentErrors } from "../errors/content-errors.ts";
import { prisma } from "../prisma/client.ts";
import {
  TARGET_DEFAULT_PAGE_SIZE,
  TARGET_MAX_PAGE_SIZE,
} from "../validators/target-content.ts";
import type {
  ActionItemView,
  BoardCapabilities,
  BoardItem,
  BoardItemsPage,
  BoardSnapshot,
  CardView,
  GroupView,
  VisitorIdentity,
} from "./content-types.ts";
import {
  requireContentVisitorIdentity,
  serializeRevision,
} from "./content-service-helpers.ts";
import {
  listTopLevelItems,
  type TopLevelItemRow,
} from "./top-level-order.ts";

type ReadBoard = {
  id: string;
  title: string;
  cardsEnabled: boolean;
  votingEnabled: boolean;
  readOnly: boolean;
  revision: bigint;
  createdAt: Date;
  expiresAt: Date;
};

type CursorPayload = {
  v: 1;
  kind: "CARD" | "GROUP";
  id: string;
  position: number;
};

const groupByKey = <Value, Key>(
  values: readonly Value[],
  getKey: (value: Value) => Key,
): Map<Key, Value[]> => {
  const grouped = new Map<Key, Value[]>();
  for (const value of values) {
    const key = getKey(value);
    const bucket = grouped.get(key);
    if (bucket) {
      bucket.push(value);
    } else {
      grouped.set(key, [value]);
    }
  }
  return grouped;
};

const assertPageLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > TARGET_MAX_PAGE_SIZE) {
    throw new RangeError(`limit must be between 1 and ${TARGET_MAX_PAGE_SIZE}`);
  }
};

const encodeCursor = (item: TopLevelItemRow): string => Buffer.from(JSON.stringify({
  v: 1,
  kind: item.kind,
  id: item.id,
  position: item.position,
} satisfies CursorPayload)).toString("base64url");

const decodeCursor = (cursor: string): CursorPayload => {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
      throw new Error("cursor is not base64url");
    }
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object") {
      throw new Error("not an object");
    }
    const value = decoded as Record<string, unknown>;
    if (
      Object.keys(value).length !== 4
      || value.v !== 1
      || (value.kind !== "CARD" && value.kind !== "GROUP")
      || typeof value.id !== "string"
      || typeof value.position !== "number"
      || !Number.isSafeInteger(value.position)
    ) {
      throw new Error("invalid fields");
    }
    return value as CursorPayload;
  } catch {
    throw contentErrors.invalidCursor();
  }
};

const loadBoard = async (
  tx: Prisma.TransactionClient,
  boardId: string,
): Promise<ReadBoard> => {
  const board = await tx.board.findFirst({
    where: { id: boardId, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      title: true,
      cardsEnabled: true,
      votingEnabled: true,
      readOnly: true,
      revision: true,
      createdAt: true,
      expiresAt: true,
    },
  });
  if (!board) {
    throw contentErrors.boardNotFound();
  }
  return board;
};

const cardCapabilities = (
  board: ReadBoard,
  access: BoardAccessContext,
  createdByMembershipId: string | null,
  grouped: boolean,
) => {
  const ownsCard = access.role === "OWNER" || createdByMembershipId === access.membershipId;
  const canMutate = !board.readOnly && board.cardsEnabled && ownsCard;
  return { canEdit: canMutate, canDelete: canMutate, canMove: canMutate && !grouped };
};

const buildBoardItems = async (
  tx: Prisma.TransactionClient,
  board: ReadBoard,
  access: BoardAccessContext,
  visitorIdentity: VisitorIdentity,
  pageRows: readonly TopLevelItemRow[],
): Promise<BoardItem[]> => {
  const cardIds = pageRows.filter((row) => row.kind === "CARD").map((row) => row.id);
  const groupIds = pageRows.filter((row) => row.kind === "GROUP").map((row) => row.id);
  const [cards, groups, originals] = await Promise.all([
    tx.card.findMany({
      where: { id: { in: cardIds }, boardId: board.id, groupId: null },
      select: {
        id: true,
        columnId: true,
        text: true,
        author: true,
        position: true,
        createdByMembershipId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { votes: true } },
      },
    }),
    tx.cardGroup.findMany({
      where: { id: { in: groupIds }, boardId: board.id },
      select: {
        id: true,
        columnId: true,
        position: true,
        title: true,
        primaryCardId: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    tx.card.findMany({
      where: { boardId: board.id, groupId: { in: groupIds } },
      orderBy: [{ groupPosition: "asc" }, { id: "asc" }],
      select: {
        id: true,
        columnId: true,
        text: true,
        author: true,
        position: true,
        groupId: true,
        groupPosition: true,
        createdByMembershipId: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { votes: true } },
      },
    }),
  ]);
  const allCardIds = [...cards.map((card) => card.id), ...originals.map((card) => card.id)];
  const viewerVotes = allCardIds.length === 0
    ? []
    : await tx.vote.findMany({
        where: { cardId: { in: allCardIds }, visitorToken: visitorIdentity },
        select: { cardId: true },
      });
  const votedCardIds = new Set(viewerVotes.map((vote) => vote.cardId));
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const originalsByGroup = groupByKey(originals, (card) => card.groupId as string);

  return pageRows.map((row): BoardItem => {
    if (row.kind === "CARD") {
      const card = cardById.get(row.id);
      if (!card) {
        throw contentErrors.invalidCursor();
      }
      return {
        kind: "CARD",
        id: card.id,
        columnId: card.columnId,
        text: card.text,
        author: card.author,
        position: card.position,
        voteCount: card._count.votes,
        viewerHasVoted: votedCardIds.has(card.id),
        ...cardCapabilities(board, access, card.createdByMembershipId, false),
        createdAt: card.createdAt.toISOString(),
        updatedAt: card.updatedAt.toISOString(),
      } satisfies CardView;
    }

    const group = groupById.get(row.id);
    if (!group) {
      throw contentErrors.invalidCursor();
    }
    const groupCards = originalsByGroup.get(group.id) ?? [];
    const serializedCards = groupCards.map((card): CardView => ({
      kind: "CARD",
      id: card.id,
      columnId: card.columnId,
      text: card.text,
      author: card.author,
      position: card.groupPosition as number,
      voteCount: card._count.votes,
      viewerHasVoted: votedCardIds.has(card.id),
      ...cardCapabilities(board, access, card.createdByMembershipId, true),
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
    }));
    return {
      kind: "GROUP",
      id: group.id,
      columnId: group.columnId,
      position: group.position,
      title: group.title,
      primaryCardId: group.primaryCardId,
      voteCount: serializedCards.reduce((sum, card) => sum + card.voteCount, 0),
      viewerHasVoted: votedCardIds.has(group.primaryCardId),
      canMove: access.role === "OWNER" && !board.readOnly && board.cardsEnabled,
      canUngroup: access.role === "OWNER" && !board.readOnly && board.cardsEnabled,
      cards: serializedCards,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    } satisfies GroupView;
  });
};

const getPageInTransaction = async ({
  tx,
  board,
  access,
  visitorIdentity,
  columnId,
  cursor,
  limit,
}: {
  tx: Prisma.TransactionClient;
  board: ReadBoard;
  access: BoardAccessContext;
  visitorIdentity: VisitorIdentity;
  columnId: string;
  cursor?: string;
  limit: number;
}): Promise<BoardItemsPage> => {
  const column = await tx.boardColumn.findFirst({
    where: { id: columnId, boardId: board.id },
    select: { id: true },
  });
  if (!column) {
    throw contentErrors.columnNotFound();
  }
  const allItems = await listTopLevelItems(tx, board.id, column.id);
  let startIndex = 0;
  if (cursor !== undefined) {
    const cursorPayload = decodeCursor(cursor);
    const anchorIndex = allItems.findIndex((item) =>
      item.id === cursorPayload.id
      && item.kind === cursorPayload.kind
      && item.position === cursorPayload.position);
    if (anchorIndex < 0) {
      throw contentErrors.invalidCursor();
    }
    startIndex = anchorIndex + 1;
  }
  const candidates = allItems.slice(startIndex, startIndex + limit + 1);
  const pageRows = candidates.slice(0, limit);
  const items = await buildBoardItems(tx, board, access, visitorIdentity, pageRows);
  return {
    columnId: column.id,
    revision: serializeRevision(board.revision),
    items,
    totalCount: allItems.length,
    nextCursor: candidates.length > limit && pageRows.length > 0
      ? encodeCursor(pageRows[pageRows.length - 1])
      : null,
  };
};

const capabilitiesFor = (
  board: ReadBoard,
  access: BoardAccessContext,
): BoardCapabilities => {
  const owner = access.role === "OWNER";
  return {
    canManageSettings: owner,
    canManageAccess: owner,
    canManageColumns: owner && !board.readOnly,
    canManageGroups: owner && !board.readOnly && board.cardsEnabled,
    canManageActionItems: owner && !board.readOnly,
    canResetVotes: owner && !board.readOnly,
    canDeleteBoard: owner,
    canLeaveBoard: !owner,
    canCreateCards: !board.readOnly && board.cardsEnabled,
    canVote: !board.readOnly && board.votingEnabled,
  };
};

const serializeActionItem = (item: {
  id: string;
  text: string;
  assignee: string | null;
  completed: boolean;
  position: number;
  sourceCardId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): ActionItemView => ({
  ...item,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

export const getTargetCardPage = async (
  boardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  columnId: string,
  cursor?: string,
  limit = TARGET_DEFAULT_PAGE_SIZE,
) => {
  assertPageLimit(limit);
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  return prisma.$transaction(async (tx) => {
    const access = await requireActiveBoardMember(boardId, visitorPayload, { client: tx });
    const board = await loadBoard(tx, boardId);
    return getPageInTransaction({
      tx,
      board,
      access,
      visitorIdentity,
      columnId,
      cursor,
      limit,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
};

export const getTargetBoardSnapshot = async (
  boardId: string,
  visitorPayload: string,
  visitorIdentity: VisitorIdentity,
  limit = TARGET_DEFAULT_PAGE_SIZE,
): Promise<BoardSnapshot> => {
  assertPageLimit(limit);
  requireContentVisitorIdentity(boardId, visitorPayload, visitorIdentity);
  return prisma.$transaction(async (tx) => {
    const access = await requireActiveBoardMember(boardId, visitorPayload, { client: tx });
    const board = await loadBoard(tx, boardId);
    const [columns, actionItems, usedVotes] = await Promise.all([
      tx.boardColumn.findMany({
        where: { boardId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, title: true, position: true, voteLimit: true },
      }),
      tx.actionItem.findMany({
        where: { boardId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
      }),
      tx.vote.groupBy({
        by: ["columnId"],
        where: { boardId, visitorToken: visitorIdentity },
        _count: { _all: true },
      }),
    ]);
    const pages = await Promise.all(columns.map((column) => getPageInTransaction({
      tx,
      board,
      access,
      visitorIdentity,
      columnId: column.id,
      limit,
    })));
    const usedByColumn = new Map(
      usedVotes.map((entry) => [entry.columnId, entry._count._all]),
    );

    return {
      id: board.id,
      title: board.title,
      revision: serializeRevision(board.revision),
      createdAt: board.createdAt.toISOString(),
      expiresAt: board.expiresAt.toISOString(),
      settings: {
        cardsEnabled: board.cardsEnabled,
        votingEnabled: board.votingEnabled,
        readOnly: board.readOnly,
      },
      viewer: { role: access.role, displayName: access.displayName },
      capabilities: capabilitiesFor(board, access),
      columns: columns.map((column, index) => ({
        ...column,
        items: pages[index].items,
        totalCount: pages[index].totalCount,
        nextCursor: pages[index].nextCursor,
      })),
      remainingVotesByColumn: Object.fromEntries(columns.map((column) => [
        column.id,
        Math.max(0, column.voteLimit - (usedByColumn.get(column.id) ?? 0)),
      ])),
      actionItems: actionItems.map(serializeActionItem),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
};

import { Prisma } from "@prisma/client";
import { requireActiveBoardMember } from "../access/acl-service.ts";
import { getBoardCardLimit } from "../config/limits.ts";
import { MAX_TARGET_BOARD_TOTAL_VOTE_RECORDS } from "../constants/access.ts";
import { contentErrors } from "../errors/content-errors.ts";
import type {
  BoardExportV2,
  ExportCard,
  ExportGroup,
} from "../export/target-export.ts";
import { prisma } from "../prisma/client.ts";
import { loadUniqueGroupVoteCounts } from "./group-vote-counts.ts";

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

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

export const getTargetBoardExport = async (
  boardId: string,
  visitorPayload: string,
  {
    env = process.env,
    exportedAt = new Date(),
  }: { env?: NodeJS.ProcessEnv; exportedAt?: Date } = {},
): Promise<BoardExportV2> => {
  const cardLimit = getBoardCardLimit(env);
  return prisma.$transaction(async (tx) => {
    await requireActiveBoardMember(boardId, visitorPayload, { client: tx });
    const board = await tx.board.findFirst({
      where: { id: boardId, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        title: true,
        cardsEnabled: true,
        votingEnabled: true,
        readOnly: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    if (!board) {
      throw contentErrors.boardNotFound();
    }
    const [boundedCards, boundedVotes] = await Promise.all([
      tx.card.findMany({
        where: { boardId },
        take: cardLimit + 1,
        select: { id: true },
      }),
      tx.vote.findMany({
        where: { boardId },
        take: MAX_TARGET_BOARD_TOTAL_VOTE_RECORDS + 1,
        select: { id: true },
      }),
    ]);
    if (
      boundedCards.length > cardLimit
      || boundedVotes.length > MAX_TARGET_BOARD_TOTAL_VOTE_RECORDS
    ) {
      throw contentErrors.boardExportLimitExceeded({
        cardLimit,
        voteLimit: MAX_TARGET_BOARD_TOTAL_VOTE_RECORDS,
      });
    }

    const [columns, cards, groups, actionItems] = await Promise.all([
      tx.boardColumn.findMany({
        where: { boardId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true, title: true, position: true, voteLimit: true },
      }),
      tx.card.findMany({
        where: { boardId },
        select: {
          id: true,
          columnId: true,
          groupId: true,
          groupPosition: true,
          position: true,
          text: true,
          author: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { votes: true } },
        },
      }),
      tx.cardGroup.findMany({
        where: { boardId },
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
      tx.actionItem.findMany({
        where: { boardId },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: {
          id: true,
          text: true,
          assignee: true,
          completed: true,
          position: true,
          sourceCardId: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    const ungroupedByColumn = groupByKey(
      cards.filter((card) => card.groupId === null),
      (card) => card.columnId,
    );
    const cardsByGroup = groupByKey(
      cards.filter((card) => card.groupId !== null),
      (card) => card.groupId as string,
    );
    const groupsByColumn = groupByKey(groups, (group) => group.columnId);
    const groupVoteCounts = await loadUniqueGroupVoteCounts(
      tx,
      boardId,
      groups.map((group) => group.id),
    );

    return {
      schemaVersion: 2,
      exportedAt: exportedAt.toISOString(),
      board: {
        id: board.id,
        title: board.title,
        createdAt: board.createdAt.toISOString(),
        expiresAt: board.expiresAt.toISOString(),
        settings: {
          cardsEnabled: board.cardsEnabled,
          votingEnabled: board.votingEnabled,
          readOnly: board.readOnly,
        },
      },
      columns: columns.map((column) => {
        const ungrouped: ExportCard[] = (ungroupedByColumn.get(column.id) ?? []).map((card) => ({
          kind: "CARD" as const,
          id: card.id,
          position: card.position,
          text: card.text,
          author: card.author,
          voteCount: card._count.votes,
          createdAt: card.createdAt.toISOString(),
          updatedAt: card.updatedAt.toISOString(),
        }));
        const grouped: ExportGroup[] = (groupsByColumn.get(column.id) ?? []).map((group) => {
          const originals: ExportCard[] = (cardsByGroup.get(group.id) ?? []).map((card) => ({
            kind: "CARD" as const,
            id: card.id,
            position: card.groupPosition as number,
            text: card.text,
            author: card.author,
            voteCount: card._count.votes,
            createdAt: card.createdAt.toISOString(),
            updatedAt: card.updatedAt.toISOString(),
          })).sort((left, right) => left.position - right.position || compareIds(left.id, right.id));
          const primaryCard = originals.find((card) => card.id === group.primaryCardId);
          if (!primaryCard) {
            throw new Error("Persisted group does not contain its primary card");
          }
          return {
            kind: "GROUP",
            id: group.id,
            position: group.position,
            title: group.title ?? primaryCard.text,
            primaryCardId: group.primaryCardId,
            voteCount: groupVoteCounts.get(group.id) ?? 0,
            cards: originals,
            createdAt: group.createdAt.toISOString(),
            updatedAt: group.updatedAt.toISOString(),
          };
        });
        return {
          id: column.id,
          title: column.title,
          position: column.position,
          voteLimit: column.voteLimit,
          items: [...ungrouped, ...grouped].sort((left, right) =>
            left.position - right.position
            || (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0)
            || compareIds(left.id, right.id)),
        };
      }),
      actionItems: actionItems.map((item) => ({
        id: item.id,
        text: item.text,
        assignee: item.assignee,
        completed: item.completed,
        position: item.position,
        sourceCardId: item.sourceCardId,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
};

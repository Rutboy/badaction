import { Prisma } from "@prisma/client";
import { ApiError } from "../errors/api-error-base.ts";
import type { ContentTransaction } from "./content-service-helpers.ts";

type VoteIdentityCount = {
  visitorToken: string;
  count: bigint;
};

const compactVoteSlots = async (
  tx: ContentTransaction,
  boardId: string,
  columnIds: readonly string[],
): Promise<void> => {
  if (columnIds.length === 0) {
    return;
  }

  await tx.$executeRaw(Prisma.sql`
    WITH ranked AS (
      SELECT
        "id",
        ROW_NUMBER() OVER (
          PARTITION BY "board_id", "column_id", "visitor_token"
          ORDER BY "quota_slot", "created_at", "id"
        )::SMALLINT AS next_slot
      FROM "votes"
      WHERE "board_id" = ${boardId}::uuid
        AND "column_id" IN (${Prisma.join(columnIds.map((id) => Prisma.sql`${id}::uuid`))})
    )
    UPDATE "votes" AS vote
    SET "quota_slot" = ranked.next_slot
    FROM ranked
    WHERE vote."id" = ranked."id"
      AND vote."quota_slot" IS DISTINCT FROM ranked.next_slot
  `);
};

export const compactColumnVoteSlots = async (
  tx: ContentTransaction,
  boardId: string,
  columnId: string,
): Promise<void> => {
  await tx.$executeRaw(Prisma.sql`
    SET CONSTRAINTS "votes_board_id_column_id_visitor_token_quota_slot_key" DEFERRED
  `);
  await compactVoteSlots(tx, boardId, [columnId]);
};

export const moveVotesBetweenColumns = async ({
  tx,
  boardId,
  cardIds,
  sourceColumnId,
  targetColumnId,
  targetVoteLimit,
}: {
  tx: ContentTransaction;
  boardId: string;
  cardIds: readonly string[];
  sourceColumnId: string;
  targetColumnId: string;
  targetVoteLimit: number;
}): Promise<void> => {
  if (sourceColumnId === targetColumnId || cardIds.length === 0) {
    return;
  }

  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "votes"
    WHERE "board_id" = ${boardId}::uuid
      AND (
        "column_id" = ${sourceColumnId}::uuid
        OR "column_id" = ${targetColumnId}::uuid
      )
    FOR UPDATE
  `);
  const [movingCounts, targetCounts] = await Promise.all([
    tx.$queryRaw<VoteIdentityCount[]>(Prisma.sql`
      SELECT "visitor_token" AS "visitorToken", COUNT(*)::BIGINT AS "count"
      FROM "votes"
      WHERE "board_id" = ${boardId}::uuid
        AND "card_id" IN (${Prisma.join(cardIds.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY "visitor_token"
    `),
    tx.$queryRaw<VoteIdentityCount[]>(Prisma.sql`
      SELECT "visitor_token" AS "visitorToken", COUNT(*)::BIGINT AS "count"
      FROM "votes"
      WHERE "board_id" = ${boardId}::uuid
        AND "column_id" = ${targetColumnId}::uuid
      GROUP BY "visitor_token"
    `),
  ]);
  const finalCounts = new Map(
    targetCounts.map((entry) => [entry.visitorToken, Number(entry.count)]),
  );
  for (const entry of movingCounts) {
    finalCounts.set(
      entry.visitorToken,
      (finalCounts.get(entry.visitorToken) ?? 0) + Number(entry.count),
    );
  }
  if ([...finalCounts.values()].some((count) => count > targetVoteLimit)) {
    throw new ApiError(
      409,
      "VOTE_MOVE_CONFLICT",
      "Перенос превысит лимит голосов в целевой колонке.",
      { targetColumnId },
    );
  }

  await tx.$executeRaw(Prisma.sql`SET CONSTRAINTS ALL DEFERRED`);
  await tx.vote.updateMany({
    where: { boardId, cardId: { in: [...cardIds] } },
    data: { columnId: targetColumnId },
  });
  await compactVoteSlots(tx, boardId, [sourceColumnId, targetColumnId]);
};

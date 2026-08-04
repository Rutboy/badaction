import { Prisma } from "@prisma/client";
import type { ContentTransaction } from "./content-service-helpers.ts";

type GroupVoteCountRow = {
  groupId: string;
  voteCount: number;
};

export const loadUniqueGroupVoteCounts = async (
  tx: ContentTransaction,
  boardId: string,
  groupIds: readonly string[],
): Promise<Map<string, number>> => {
  if (groupIds.length === 0) {
    return new Map();
  }

  const uniqueGroupIds = [...new Set(groupIds)];
  const rows = await tx.$queryRaw<GroupVoteCountRow[]>(Prisma.sql`
    SELECT
      card."group_id" AS "groupId",
      COUNT(DISTINCT vote."visitor_token")::integer AS "voteCount"
    FROM "votes" AS vote
    INNER JOIN "cards" AS card
      ON card."id" = vote."card_id"
      AND card."board_id" = vote."board_id"
      AND card."column_id" = vote."column_id"
    WHERE vote."board_id" = ${boardId}::uuid
      AND card."group_id" IN (
        ${Prisma.join(uniqueGroupIds.map((groupId) => Prisma.sql`${groupId}::uuid`))}
      )
    GROUP BY card."group_id"
  `);

  return new Map(rows.map((row) => [row.groupId, row.voteCount]));
};

import { Prisma } from "@prisma/client";
import { ApiError } from "../errors/api-error-base.ts";
import {
  BOARD_EVENT_CHANNEL,
  type BoardMutationEventType,
  serializeBoardMutationEvent,
} from "./board-events.ts";

export const incrementBoardRevision = async (
  tx: Prisma.TransactionClient,
  boardId: string,
  eventType: BoardMutationEventType,
): Promise<bigint> => {
  const rows = await tx.$queryRaw<Array<{ revision: bigint }>>(Prisma.sql`
    UPDATE "boards"
    SET "revision" = "revision" + 1
    WHERE "id" = ${boardId}::uuid
    RETURNING "revision"
  `);
  const revision = rows[0]?.revision;
  if (revision === undefined) {
    throw new ApiError(404, "BOARD_NOT_FOUND", "Board not found.");
  }

  const notification = serializeBoardMutationEvent({
    boardId,
    revision: revision.toString(10),
    type: eventType,
  });
  await tx.$queryRaw<Array<{ notified: string }>>(Prisma.sql`
    SELECT pg_notify(${BOARD_EVENT_CHANNEL}, ${notification})::text AS "notified"
  `);

  return revision;
};

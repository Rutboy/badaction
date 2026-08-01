import { Prisma } from "@prisma/client";
import { requireActiveBoardMember } from "../access/acl-service.ts";
import { contentErrors } from "../errors/content-errors.ts";
import { prisma } from "../prisma/client.ts";
import { serializeRevision } from "./content-service-helpers.ts";

export type BoardEventAccessState = {
  revision: string;
};

export const getBoardEventAccessState = async (
  boardId: string,
  visitorPayload: string,
): Promise<BoardEventAccessState> => prisma.$transaction(async (tx) => {
  await requireActiveBoardMember(boardId, visitorPayload, { client: tx });
  const board = await tx.board.findFirst({
    where: { id: boardId, expiresAt: { gt: new Date() } },
    select: { revision: true },
  });
  if (!board) {
    throw contentErrors.boardNotFound();
  }

  return { revision: serializeRevision(board.revision) };
}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

import { Prisma } from "@prisma/client";
import { createOwnerMembershipInTransaction } from "../access/acl-service.ts";
import { getOrCreateSessionInTransaction } from "../access/session-service.ts";
import { getBoardRetentionDays } from "../config/limits.ts";
import { MAX_ACTIVE_OWNED_BOARDS_PER_SESSION } from "../constants/access.ts";
import { ApiError } from "../errors/api-error-base.ts";
import {
  incrementBoardRevision,
  lockBoardForMutation,
  requireOwner,
  serializeRevision,
  withContentTransaction,
} from "./content-service-helpers.ts";

export const DEFAULT_BOARD_COLUMNS = [
  { title: "Уже хорошо", position: 1024, voteLimit: 3 },
  { title: "Следует улучшить", position: 2048, voteLimit: 3 },
] as const;

type BoardPatch = {
  title?: string;
  cardsEnabled?: boolean;
  votingEnabled?: boolean;
  readOnly?: boolean;
};

const normalizeBoardTitle = (title: string): string => {
  const normalized = title.trim();
  if (normalized.length < 1 || normalized.length > 120) {
    throw new RangeError("title must contain between 1 and 120 characters after trimming");
  }

  return normalized;
};

export const createTargetBoard = async (
  visitorPayload: string,
  title: string,
) => {
  const normalizedTitle = normalizeBoardTitle(title);
  const createdAt = new Date();
  const expiresAt = new Date(
    createdAt.getTime() + getBoardRetentionDays() * 24 * 60 * 60 * 1000,
  );

  return withContentTransaction(async (tx) => {
    const session = await getOrCreateSessionInTransaction(tx, visitorPayload, { now: createdAt });
    const lockedSessions = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
      FROM "anonymous_sessions"
      WHERE "id" = ${session.id}::uuid
        AND "revoked_at" IS NULL
        AND "expires_at" > ${createdAt}
      FOR UPDATE
    `);
    if (lockedSessions.length !== 1) {
      throw new ApiError(
        401,
        "ANONYMOUS_SESSION_INACTIVE",
        "Анонимная сессия недействительна. Обновите страницу и повторите запрос.",
      );
    }

    const ownedBoards = await tx.boardMembership.count({
      where: {
        sessionId: session.id,
        role: "OWNER",
        revokedAt: null,
        board: { expiresAt: { gt: createdAt } },
      },
    });
    if (ownedBoards >= MAX_ACTIVE_OWNED_BOARDS_PER_SESSION) {
      throw new ApiError(
        422,
        "SESSION_BOARD_LIMIT_REACHED",
        `Одна анонимная сессия может владеть не более чем ${MAX_ACTIVE_OWNED_BOARDS_PER_SESSION} активными досками.`,
        { limit: MAX_ACTIVE_OWNED_BOARDS_PER_SESSION },
      );
    }

    const board = await tx.board.create({
      data: {
        title: normalizedTitle,
        cardsEnabled: true,
        votingEnabled: true,
        readOnly: false,
        revision: 0n,
        createdAt,
        expiresAt,
      },
      select: {
        id: true,
        title: true,
        revision: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    await createOwnerMembershipInTransaction(tx, {
      boardId: board.id,
      sessionId: session.id,
    });
    await tx.boardColumn.createMany({
      data: DEFAULT_BOARD_COLUMNS.map((column) => ({
        boardId: board.id,
        ...column,
      })),
    });

    return {
      id: board.id,
      title: board.title,
      revision: serializeRevision(board.revision),
      createdAt: board.createdAt,
      expiresAt: board.expiresAt,
    };
  });
};

export const updateBoardSettings = async (
  boardId: string,
  visitorPayload: string,
  patch: BoardPatch,
) => withContentTransaction(async (tx) => {
  const { board, access } = await lockBoardForMutation(tx, boardId, visitorPayload);
  requireOwner(access);

  const title = patch.title === undefined ? board.title : normalizeBoardTitle(patch.title);
  const cardsEnabled = patch.cardsEnabled ?? board.cardsEnabled;
  const votingEnabled = patch.votingEnabled ?? board.votingEnabled;
  const readOnly = patch.readOnly ?? board.readOnly;
  const changed = title !== board.title
    || cardsEnabled !== board.cardsEnabled
    || votingEnabled !== board.votingEnabled
    || readOnly !== board.readOnly;

  if (!changed) {
    return {
      revision: serializeRevision(board.revision),
      title: board.title,
      settings: {
        cardsEnabled: board.cardsEnabled,
        votingEnabled: board.votingEnabled,
        readOnly: board.readOnly,
      },
    };
  }

  await tx.board.update({
    where: { id: boardId },
    data: { title, cardsEnabled, votingEnabled, readOnly },
  });
  const revision = await incrementBoardRevision(tx, boardId, "board.updated");

  return {
    revision: serializeRevision(revision),
    title,
    settings: { cardsEnabled, votingEnabled, readOnly },
  };
});

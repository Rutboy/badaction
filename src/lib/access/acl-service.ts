import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  MAX_BOARD_OWNER_HISTORY_RECORDS,
  MAX_BOARD_PARTICIPANT_INVITATION_RECORDS,
  MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS,
  MAX_PARTICIPANT_INVITATION_USES,
} from "../constants/access.ts";
import { ApiError } from "../errors/api-error-base.ts";
import { prisma } from "../prisma/client.ts";
import { hmacSha256 } from "../security/hmac.ts";
import { incrementBoardRevision } from "../realtime/transactional-board-update.ts";
import {
  getBoardAccessSecret,
  getOrCreateSessionInTransaction,
  requireActiveAnonymousSession,
} from "./session-service.ts";

const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_INVITATION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_INVITATIONS = 20;
const MAX_ACTIVE_PARTICIPANTS = 100;
const INVITATION_HISTORY_LIMIT = 100;
const MAX_TRANSACTION_ATTEMPTS = 5;

type AccessClient = Prisma.TransactionClient | typeof prisma;
type MembershipRole = "OWNER" | "PARTICIPANT";

type AccessOptions = {
  client?: AccessClient;
  env?: NodeJS.ProcessEnv;
  lock?: boolean;
  now?: Date;
};

type InvitationOptions = {
  expiresAt?: Date;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

type ParticipantInvitationOptions = InvitationOptions & {
  maxUses?: number;
};

const boardAccessNotFound = () => new ApiError(404, "BOARD_NOT_FOUND", "Board not found.");
const ownerRequired = () => new ApiError(
  403,
  "BOARD_OWNER_REQUIRED",
  "Only the board owner can perform this action.",
);
const invitationInvalid = () => new ApiError(
  404,
  "INVITATION_INVALID",
  "The invitation is invalid, expired, or has already been used.",
);

const isTransactionConflict = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2034" || error.code === "P2002") {
      return true;
    }

    const sqlState = error.code === "P2010" ? error.meta?.code : undefined;
    return sqlState === "40001" || sqlState === "40P01";
  }

  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : undefined;
  return code === "40001" || code === "40P01";
};

const withSerializableRetry = async <T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> => {
  for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isTransactionConflict(error) || attempt === MAX_TRANSACTION_ATTEMPTS - 1) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 10 * 2 ** attempt));
    }
  }

  throw new Error("ACL transaction retry loop exhausted unexpectedly");
};

const lockActiveBoard = async (
  tx: Prisma.TransactionClient,
  boardId: string,
  now: Date,
) => {
  const rows = await tx.$queryRaw<Array<{ id: string; expiresAt: Date }>>(Prisma.sql`
    SELECT "id", "expires_at" AS "expiresAt"
    FROM "boards"
    WHERE "id" = ${boardId}::uuid
      AND "expires_at" > ${now}
    FOR UPDATE
  `);

  const board = rows[0];
  if (!board) {
    throw boardAccessNotFound();
  }

  return board;
};

// TIMESTAMPTZ(3) can round a database creation time just past the application
// timestamp captured before its transaction starts.
const revokeBoardMembershipRows = (
  tx: Prisma.TransactionClient,
  now: Date,
  where: Prisma.Sql,
) => tx.$executeRaw(Prisma.sql`
  UPDATE "board_memberships" AS membership
  SET "revoked_at" = GREATEST(membership."created_at", ${now})
  WHERE ${where}
`);

const revokeBoardInvitationRows = (
  tx: Prisma.TransactionClient,
  now: Date,
  where: Prisma.Sql,
) => tx.$executeRaw(Prisma.sql`
  UPDATE "board_invitations" AS invitation
  SET "revoked_at" = GREATEST(invitation."created_at", ${now})
  WHERE ${where}
`);

const assertInvitationSettings = (
  expiresAt: Date,
  now: Date,
  boardExpiresAt: Date,
) => {
  if (
    !Number.isFinite(expiresAt.getTime())
    || expiresAt <= now
    || expiresAt.getTime() - now.getTime() > MAX_INVITATION_LIFETIME_MS
    || expiresAt > boardExpiresAt
  ) {
    throw new RangeError("Invitation expiry must be in the future, within 30 days and before board expiry");
  }
};

const createRawInvitationToken = () => randomBytes(32).toString("base64url");

const assertParticipantInvitationHistoryCapacity = async (
  tx: Prisma.TransactionClient,
  boardId: string,
) => {
  const invitationCount = await tx.boardInvitation.count({
    where: { boardId, role: "PARTICIPANT" },
  });
  if (invitationCount >= MAX_BOARD_PARTICIPANT_INVITATION_RECORDS) {
    throw new ApiError(
      422,
      "BOARD_INVITATION_HISTORY_LIMIT_REACHED",
      `This board has reached its history limit of ${MAX_BOARD_PARTICIPANT_INVITATION_RECORDS} participant invitations.`,
      { limit: MAX_BOARD_PARTICIPANT_INVITATION_RECORDS },
    );
  }
};

const assertParticipantMembershipHistoryCapacity = async (
  tx: Prisma.TransactionClient,
  boardId: string,
) => {
  const membershipCount = await tx.boardMembership.count({
    where: { boardId, role: "PARTICIPANT" },
  });
  if (membershipCount >= MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS) {
    throw new ApiError(
      422,
      "BOARD_MEMBERSHIP_HISTORY_LIMIT_REACHED",
      `This board has reached its history limit of ${MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS} participant memberships.`,
      { limit: MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS },
    );
  }
};

const pruneOwnerInvitationHistoryForReplacement = async (
  tx: Prisma.TransactionClient,
  boardId: string,
) => {
  const ownerInvitationCount = await tx.boardInvitation.count({
    where: { boardId, role: "OWNER" },
  });
  const recordsToDelete = ownerInvitationCount - MAX_BOARD_OWNER_HISTORY_RECORDS + 1;
  if (recordsToDelete <= 0) {
    return;
  }

  const staleInvitations = await tx.boardInvitation.findMany({
    where: { boardId, role: "OWNER", revokedAt: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: recordsToDelete,
    select: { id: true },
  });
  if (staleInvitations.length !== recordsToDelete) {
    throw new Error("Owner invitation history cannot be rotated safely");
  }

  await tx.boardInvitation.deleteMany({
    where: { id: { in: staleInvitations.map((invitation) => invitation.id) } },
  });
};

const pruneOwnerMembershipHistoryForReplacement = async (
  tx: Prisma.TransactionClient,
  boardId: string,
) => {
  const ownerMembershipCount = await tx.boardMembership.count({
    where: { boardId, role: "OWNER" },
  });
  const recordsToDelete = ownerMembershipCount - MAX_BOARD_OWNER_HISTORY_RECORDS + 1;
  if (recordsToDelete <= 0) {
    return;
  }

  const staleMemberships = await tx.boardMembership.findMany({
    where: { boardId, role: "OWNER", revokedAt: { not: null } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: recordsToDelete,
    select: { id: true },
  });
  if (staleMemberships.length !== recordsToDelete) {
    throw new Error("Owner membership history cannot be rotated safely");
  }

  const staleMembershipIds = staleMemberships.map((membership) => membership.id);
  // Revoked owner history is bounded and may be rotated, while cards must
  // remain. Clearing only references to the exact rows selected above converts
  // those cards to the same owner-only semantics as legacy cards and cannot
  // grant ownership to a replacement membership.
  await tx.card.updateMany({
    where: {
      boardId,
      createdByMembershipId: { in: staleMembershipIds },
    },
    data: { createdByMembershipId: null },
  });

  await tx.boardMembership.deleteMany({
    where: { id: { in: staleMembershipIds } },
  });
};

export const deriveInvitationTokenHash = (
  token: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (!INVITATION_TOKEN_PATTERN.test(token)) {
    throw invitationInvalid();
  }

  return hmacSha256(getBoardAccessSecret(env), `board-invitation:v1\0${token}`);
};

export type BoardAccessContext = {
  sessionId: string;
  membershipId: string;
  role: MembershipRole;
  displayName: string;
};

export const createOwnerMembershipInTransaction = async (
  tx: Prisma.TransactionClient,
  {
    boardId,
    sessionId,
    displayName = "Owner",
  }: {
    boardId: string;
    sessionId: string;
    displayName?: string;
  },
) => tx.boardMembership.create({
  data: {
    boardId,
    sessionId,
    role: "OWNER",
    displayName: displayName.trim(),
  },
});

export const requireActiveBoardMember = async (
  boardId: string,
  visitorPayload: string,
  {
    client = prisma,
    env = process.env,
    lock = false,
    now = new Date(),
  }: AccessOptions = {},
): Promise<BoardAccessContext> => {
  if (lock) {
    let session: Awaited<ReturnType<typeof requireActiveAnonymousSession>>;
    try {
      session = await requireActiveAnonymousSession(visitorPayload, { client, env, now });
    } catch (error) {
      if (error instanceof ApiError && error.code === "ANONYMOUS_SESSION_INACTIVE") {
        throw boardAccessNotFound();
      }

      throw error;
    }
    const rows = await client.$queryRaw<BoardAccessContext[]>(Prisma.sql`
      SELECT
        session."id" AS "sessionId",
        membership."id" AS "membershipId",
        membership."role",
        membership."display_name" AS "displayName"
      FROM "anonymous_sessions" AS session
      INNER JOIN "board_memberships" AS membership
        ON membership."session_id" = session."id"
      INNER JOIN "boards" AS board
        ON board."id" = membership."board_id"
      WHERE session."id" = ${session.id}::uuid
        AND session."revoked_at" IS NULL
        AND session."expires_at" > ${now}
        AND membership."board_id" = ${boardId}::uuid
        AND membership."revoked_at" IS NULL
        AND board."expires_at" > ${now}
      FOR UPDATE OF session, membership
    `);
    const context = rows[0];
    if (!context) {
      throw boardAccessNotFound();
    }

    return context;
  }

  let session: Awaited<ReturnType<typeof requireActiveAnonymousSession>>;
  try {
    session = await requireActiveAnonymousSession(visitorPayload, { client, env, now });
  } catch (error) {
    if (error instanceof ApiError && error.code === "ANONYMOUS_SESSION_INACTIVE") {
      throw boardAccessNotFound();
    }

    throw error;
  }

  const membership = await client.boardMembership.findFirst({
    where: {
      boardId,
      sessionId: session.id,
      revokedAt: null,
      board: { expiresAt: { gt: now } },
    },
    select: {
      id: true,
      role: true,
      displayName: true,
    },
  });

  if (!membership) {
    throw boardAccessNotFound();
  }

  return {
    sessionId: session.id,
    membershipId: membership.id,
    role: membership.role,
    displayName: membership.displayName,
  };
};

const revokeInactiveOwnerMemberships = async (
  tx: Prisma.TransactionClient,
  boardId: string,
  now: Date,
) => {
  await tx.$executeRaw(Prisma.sql`
    UPDATE "board_memberships" AS membership
    SET "revoked_at" = GREATEST(membership."created_at", ${now})
    FROM "anonymous_sessions" AS session
    WHERE membership."board_id" = ${boardId}::uuid
      AND membership."role" = 'OWNER'
      AND membership."revoked_at" IS NULL
      AND session."id" = membership."session_id"
      AND (session."revoked_at" IS NOT NULL OR session."expires_at" <= ${now})
  `);
};

export const requireActiveBoardOwner = async (
  boardId: string,
  visitorPayload: string,
  options: AccessOptions = {},
) => {
  const context = await requireActiveBoardMember(boardId, visitorPayload, options);
  if (context.role !== "OWNER") {
    throw ownerRequired();
  }

  return context;
};

const createInvitationInTransaction = async (
  tx: Prisma.TransactionClient,
  {
    boardId,
    role,
    createdBySessionId,
    expiresAt,
    maxUses,
    env,
  }: {
    boardId: string;
    role: MembershipRole;
    createdBySessionId: string | null;
    expiresAt: Date;
    maxUses: number;
    env: NodeJS.ProcessEnv;
  },
) => {
  const token = createRawInvitationToken();
  const invitation = await tx.boardInvitation.create({
    data: {
      boardId,
      tokenHash: deriveInvitationTokenHash(token, env),
      role,
      createdBySessionId,
      expiresAt,
      maxUses,
    },
    select: {
      id: true,
      boardId: true,
      role: true,
      expiresAt: true,
      maxUses: true,
    },
  });

  return { ...invitation, token };
};

export const createParticipantInvitation = async (
  boardId: string,
  visitorPayload: string,
  {
    expiresAt,
    maxUses = 1,
    env = process.env,
    now = new Date(),
  }: ParticipantInvitationOptions = {},
) => withSerializableRetry(async (tx) => {
  if (
    !Number.isInteger(maxUses)
    || maxUses < 1
    || maxUses > MAX_PARTICIPANT_INVITATION_USES
  ) {
    throw new RangeError(
      `Participant invitation maxUses must be an integer from 1 to ${MAX_PARTICIPANT_INVITATION_USES}`,
    );
  }

  const board = await lockActiveBoard(tx, boardId, now);
  const owner = await requireActiveBoardOwner(boardId, visitorPayload, {
    client: tx,
    env,
    lock: true,
    now,
  });
  await assertParticipantInvitationHistoryCapacity(tx, boardId);
  const resolvedExpiresAt = expiresAt ?? new Date(
    Math.min(board.expiresAt.getTime(), now.getTime() + DEFAULT_INVITATION_LIFETIME_MS),
  );
  assertInvitationSettings(resolvedExpiresAt, now, board.expiresAt);
  const activeInvitationCounts = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
    SELECT COUNT(*)::int AS "count"
    FROM "board_invitations"
    WHERE "board_id" = ${boardId}::uuid
      AND "role" = 'PARTICIPANT'
      AND "revoked_at" IS NULL
      AND "expires_at" > ${now}
      AND "use_count" < "max_uses"
  `);
  if ((activeInvitationCounts[0]?.count ?? 0) >= MAX_ACTIVE_INVITATIONS) {
    throw new ApiError(
      422,
      "BOARD_INVITATION_LIMIT_REACHED",
      `A board can have at most ${MAX_ACTIVE_INVITATIONS} active invitations.`,
    );
  }

  return createInvitationInTransaction(tx, {
    boardId,
    role: "PARTICIPANT",
    createdBySessionId: owner.sessionId,
    expiresAt: resolvedExpiresAt,
    maxUses,
    env,
  });
});

export const createLegacyOwnerClaimInvitation = async (
  boardId: string,
  {
    expiresAt,
    env = process.env,
    now = new Date(),
  }: InvitationOptions = {},
) => withSerializableRetry(async (tx) => {
  const board = await lockActiveBoard(tx, boardId, now);
  await revokeInactiveOwnerMemberships(tx, boardId, now);
  const activeOwner = await tx.boardMembership.findFirst({
    where: { boardId, role: "OWNER", revokedAt: null },
    select: { id: true },
  });
  if (activeOwner) {
    throw new ApiError(409, "BOARD_OWNER_ALREADY_EXISTS", "This board already has an owner.");
  }

  await revokeBoardInvitationRows(tx, now, Prisma.sql`
    invitation."board_id" = ${boardId}::uuid
      AND invitation."role" = 'OWNER'
      AND invitation."revoked_at" IS NULL
  `);
  await pruneOwnerInvitationHistoryForReplacement(tx, boardId);

  const resolvedExpiresAt = expiresAt ?? new Date(
    Math.min(board.expiresAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000),
  );
  assertInvitationSettings(resolvedExpiresAt, now, board.expiresAt);

  return createInvitationInTransaction(tx, {
    boardId,
    role: "OWNER",
    createdBySessionId: null,
    expiresAt: resolvedExpiresAt,
    maxUses: 1,
    env,
  });
});

type LockedInvitation = {
  id: string;
  boardId: string;
  role: MembershipRole;
  expiresAt: Date;
  revokedAt: Date | null;
  maxUses: number;
  useCount: number;
};

export const redeemBoardInvitation = async (
  token: string,
  visitorPayload: string,
  displayName = "Participant",
  {
    env = process.env,
    now = new Date(),
  }: Omit<AccessOptions, "client"> = {},
) => {
  const tokenHash = deriveInvitationTokenHash(token, env);
  const normalizedDisplayName = displayName.trim();
  if (normalizedDisplayName.length < 1 || normalizedDisplayName.length > 80) {
    throw new ApiError(400, "VALIDATION_ERROR", "The participant name must contain between 1 and 80 characters.");
  }

  return withSerializableRetry(async (tx) => {
    const candidate = await tx.boardInvitation.findUnique({
      where: { tokenHash },
      select: { boardId: true },
    });
    if (!candidate) {
      throw invitationInvalid();
    }

    await lockActiveBoard(tx, candidate.boardId, now);
    const invitations = await tx.$queryRaw<LockedInvitation[]>(Prisma.sql`
      SELECT
        "id",
        "board_id" AS "boardId",
        "role",
        "expires_at" AS "expiresAt",
        "revoked_at" AS "revokedAt",
        "max_uses" AS "maxUses",
        "use_count" AS "useCount"
      FROM "board_invitations"
      WHERE "token_hash" = ${tokenHash}
      FOR UPDATE
    `);
    const invitation = invitations[0];
    if (!invitation) {
      throw invitationInvalid();
    }

    const session = await getOrCreateSessionInTransaction(tx, visitorPayload, { env, now });
    const priorRedemption = await tx.invitationRedemption.findUnique({
      where: {
        invitationId_sessionId: {
          invitationId: invitation.id,
          sessionId: session.id,
        },
      },
      select: { id: true },
    });
    const activeMembership = await tx.boardMembership.findFirst({
      where: {
        boardId: invitation.boardId,
        sessionId: session.id,
        revokedAt: null,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        role: true,
        displayName: true,
        revokedAt: true,
      },
    });

    if (priorRedemption) {
      if (!activeMembership) {
        throw invitationInvalid();
      }

      return {
        boardId: invitation.boardId,
        membershipId: activeMembership.id,
        role: activeMembership.role,
        displayName: activeMembership.displayName,
      };
    }

    if (
      invitation.revokedAt
      || invitation.expiresAt <= now
      || invitation.useCount >= invitation.maxUses
    ) {
      throw invitationInvalid();
    }

    if (invitation.role === "OWNER") {
      await revokeInactiveOwnerMemberships(tx, invitation.boardId, now);
      const activeOwner = await tx.boardMembership.findFirst({
        where: { boardId: invitation.boardId, role: "OWNER", revokedAt: null },
        select: { sessionId: true },
      });
      if (activeOwner && activeOwner.sessionId !== session.id) {
        throw invitationInvalid();
      }
    }

    if (
      invitation.role === "PARTICIPANT"
      && !activeMembership
    ) {
      const activeParticipants = await tx.boardMembership.count({
        where: {
          boardId: invitation.boardId,
          role: "PARTICIPANT",
          revokedAt: null,
        },
      });
      if (activeParticipants >= MAX_ACTIVE_PARTICIPANTS) {
        throw new ApiError(
          422,
          "BOARD_PARTICIPANT_LIMIT_REACHED",
          `A board can have at most ${MAX_ACTIVE_PARTICIPANTS} active participants.`,
        );
      }
    }

    const createsMembership = !activeMembership
      || (activeMembership.role !== invitation.role && activeMembership.role !== "OWNER");
    if (createsMembership) {
      if (invitation.role === "OWNER") {
        await pruneOwnerMembershipHistoryForReplacement(tx, invitation.boardId);
      } else {
        await assertParticipantMembershipHistoryCapacity(tx, invitation.boardId);
      }
    }

    let membership;
    if (activeMembership) {
      if (
        activeMembership.role === invitation.role
        || activeMembership.role === "OWNER"
      ) {
        membership = activeMembership;
      } else {
        await revokeBoardMembershipRows(tx, now, Prisma.sql`
          membership."id" = ${activeMembership.id}::uuid
        `);
        membership = await tx.boardMembership.create({
          data: {
            boardId: invitation.boardId,
            sessionId: session.id,
            role: invitation.role,
            displayName: invitation.role === "OWNER" ? "Owner" : normalizedDisplayName,
          },
          select: { id: true, role: true, displayName: true },
        });
      }
    } else {
      membership = await tx.boardMembership.create({
        data: {
          boardId: invitation.boardId,
          sessionId: session.id,
          role: invitation.role,
          displayName: invitation.role === "OWNER" ? "Owner" : normalizedDisplayName,
        },
        select: { id: true, role: true, displayName: true },
      });
    }

    await tx.invitationRedemption.create({
      data: {
        invitationId: invitation.id,
        membershipId: membership.id,
        boardId: invitation.boardId,
        sessionId: session.id,
      },
    });
    await tx.boardInvitation.update({
      where: { id: invitation.id },
      data: { useCount: { increment: 1 } },
    });

    if (invitation.role === "OWNER") {
      await revokeBoardInvitationRows(tx, now, Prisma.sql`
        invitation."board_id" = ${invitation.boardId}::uuid
          AND invitation."role" = 'OWNER'
          AND invitation."id" <> ${invitation.id}::uuid
          AND invitation."revoked_at" IS NULL
      `);
    }

    return {
      boardId: invitation.boardId,
      membershipId: membership.id,
      role: membership.role,
      displayName: membership.displayName,
    };
  });
};

export const listBoardInvitations = async (
  boardId: string,
  visitorPayload: string,
  options: AccessOptions = {},
) => {
  const { client = prisma, now = new Date() } = options;
  await requireActiveBoardOwner(boardId, visitorPayload, options);
  const invitationSelect = {
    id: true,
    createdAt: true,
    expiresAt: true,
    revokedAt: true,
    maxUses: true,
    useCount: true,
  } satisfies Prisma.BoardInvitationSelect;
  const [activeInvitationCandidates, recentInvitations] = await Promise.all([
    client.boardInvitation.findMany({
      where: {
        boardId,
        role: "PARTICIPANT",
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: "desc" },
      select: invitationSelect,
    }),
    client.boardInvitation.findMany({
      where: { boardId, role: "PARTICIPANT" },
      orderBy: { createdAt: "desc" },
      take: INVITATION_HISTORY_LIMIT,
      select: invitationSelect,
    }),
  ]);
  const activeInvitations = activeInvitationCandidates
    .filter((invitation) => invitation.useCount < invitation.maxUses)
    .slice(0, MAX_ACTIVE_INVITATIONS);
  const activeIds = new Set(activeInvitations.map((invitation) => invitation.id));
  const invitations = [
    ...activeInvitations,
    ...recentInvitations.filter((invitation) => !activeIds.has(invitation.id)),
  ].slice(0, INVITATION_HISTORY_LIMIT);

  return invitations.map((invitation) => ({
    ...invitation,
    active: !invitation.revokedAt
      && invitation.expiresAt > now
      && invitation.useCount < invitation.maxUses,
  }));
};

export const revokeBoardInvitation = async (
  boardId: string,
  invitationId: string,
  visitorPayload: string,
  { env = process.env, now = new Date() }: Omit<AccessOptions, "client"> = {},
) => withSerializableRetry(async (tx) => {
  await lockActiveBoard(tx, boardId, now);
  await requireActiveBoardOwner(boardId, visitorPayload, {
    client: tx,
    env,
    lock: true,
    now,
  });
  const revokedCount = await revokeBoardInvitationRows(tx, now, Prisma.sql`
    invitation."id" = ${invitationId}::uuid
      AND invitation."board_id" = ${boardId}::uuid
      AND invitation."role" = 'PARTICIPANT'
      AND invitation."revoked_at" IS NULL
  `);
  if (revokedCount === 0) {
    throw new ApiError(404, "INVITATION_NOT_FOUND", "Invitation not found.");
  }
});

export const listBoardParticipants = async (
  boardId: string,
  visitorPayload: string,
  options: AccessOptions = {},
) => {
  const { client = prisma } = options;
  const owner = await requireActiveBoardOwner(boardId, visitorPayload, options);
  const participants = await client.boardMembership.findMany({
    where: { boardId, role: "PARTICIPANT", revokedAt: null },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      displayName: true,
      createdAt: true,
    },
  });

  return {
    currentMembershipId: owner.membershipId,
    participants,
  };
};

export const updateCurrentMembershipDisplayName = async (
  boardId: string,
  visitorPayload: string,
  displayName: string,
  { env = process.env, now = new Date() }: Omit<AccessOptions, "client"> = {},
) => withSerializableRetry(async (tx) => {
  await lockActiveBoard(tx, boardId, now);
  const membership = await requireActiveBoardMember(boardId, visitorPayload, {
    client: tx,
    env,
    lock: true,
    now,
  });
  const normalizedDisplayName = displayName.trim();
  if (normalizedDisplayName.length < 1 || normalizedDisplayName.length > 80) {
    throw new ApiError(400, "VALIDATION_ERROR", "The name must contain between 1 and 80 characters.");
  }

  if (normalizedDisplayName === membership.displayName) {
    const board = await tx.board.findUniqueOrThrow({
      where: { id: boardId },
      select: { revision: true },
    });
    return {
      displayName: membership.displayName,
      revision: board.revision.toString(10),
    };
  }

  await tx.boardMembership.update({
    where: { id: membership.membershipId },
    data: { displayName: normalizedDisplayName },
  });
  const revision = await incrementBoardRevision(tx, boardId, "board.updated");
  return {
    displayName: normalizedDisplayName,
    revision: revision.toString(10),
  };
});

export const revokeBoardParticipant = async (
  boardId: string,
  membershipId: string,
  visitorPayload: string,
  { env = process.env, now = new Date() }: Omit<AccessOptions, "client"> = {},
) => withSerializableRetry(async (tx) => {
  await lockActiveBoard(tx, boardId, now);
  await requireActiveBoardOwner(boardId, visitorPayload, {
    client: tx,
    env,
    lock: true,
    now,
  });
  const revokedCount = await revokeBoardMembershipRows(tx, now, Prisma.sql`
    membership."id" = ${membershipId}::uuid
      AND membership."board_id" = ${boardId}::uuid
      AND membership."role" = 'PARTICIPANT'
      AND membership."revoked_at" IS NULL
  `);
  if (revokedCount === 0) {
    throw new ApiError(404, "MEMBERSHIP_NOT_FOUND", "Participant not found.");
  }
});

export const leaveBoard = async (
  boardId: string,
  visitorPayload: string,
  { env = process.env, now = new Date() }: Omit<AccessOptions, "client"> = {},
) => withSerializableRetry(async (tx) => {
  await lockActiveBoard(tx, boardId, now);
  const membership = await requireActiveBoardMember(boardId, visitorPayload, {
    client: tx,
    env,
    lock: true,
    now,
  });
  if (membership.role === "OWNER") {
    throw new ApiError(409, "OWNER_CANNOT_LEAVE", "The board owner cannot leave the board.");
  }

  await revokeBoardMembershipRows(tx, now, Prisma.sql`
    membership."id" = ${membership.membershipId}::uuid
  `);
});

export const deleteBoardAsOwner = async (
  boardId: string,
  visitorPayload: string,
  { env = process.env, now = new Date() }: Omit<AccessOptions, "client"> = {},
) => withSerializableRetry(async (tx) => {
  await lockActiveBoard(tx, boardId, now);
  await requireActiveBoardOwner(boardId, visitorPayload, {
    client: tx,
    env,
    lock: true,
    now,
  });
  const boardSessionIds = await tx.boardMembership.findMany({
    where: { boardId },
    distinct: ["sessionId"],
    select: { sessionId: true },
  });
  await tx.board.delete({ where: { id: boardId } });
  if (boardSessionIds.length > 0) {
    await tx.anonymousSession.deleteMany({
      where: {
        id: { in: boardSessionIds.map((membership) => membership.sessionId) },
        revokedAt: null,
        memberships: { none: {} },
        createdInvitations: { none: {} },
      },
    });
  }
});

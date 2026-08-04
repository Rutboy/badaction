import type { Prisma } from "@prisma/client";
import {
  ANONYMOUS_CREDENTIAL_LIFETIME_DAYS,
  MAX_BOARD_RETENTION_DAYS,
} from "../constants/access.ts";
import { ApiError } from "../errors/api-error-base.ts";
import { prisma } from "../prisma/client.ts";
import { getServerSecret, hmacSha256 } from "../security/hmac.ts";

const DEVELOPMENT_SECRET = "development-only-board-access-secret";
const VERIFIED_VISITOR_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const ANONYMOUS_SESSION_LIFETIME_MS = ANONYMOUS_CREDENTIAL_LIFETIME_DAYS
  * 24
  * 60
  * 60
  * 1000
  + 24 * 60 * 60 * 1000;
const SESSION_REFRESH_THRESHOLD_MS = MAX_BOARD_RETENTION_DAYS * 24 * 60 * 60 * 1000;

type SessionClient = Prisma.TransactionClient | typeof prisma;

type SessionServiceOptions = {
  client?: SessionClient;
  env?: NodeJS.ProcessEnv;
  now?: Date;
};

export type AccessibleBoardSummary = {
  id: string;
  title: string;
  role: "OWNER" | "PARTICIPANT";
  createdAt: string;
  expiresAt: string;
};

const inactiveSession = () => new ApiError(
  401,
  "ANONYMOUS_SESSION_INACTIVE",
  "Your anonymous session is no longer active. Refresh and try again.",
);

const toSessionContext = (session: {
  id: string;
  createdAt: Date;
  expiresAt: Date;
}) => ({
  id: session.id,
  createdAt: session.createdAt,
  expiresAt: session.expiresAt,
});

const assertAndRefreshSession = async (
  client: SessionClient,
  session: {
    id: string;
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
  },
  now: Date,
) => {
  if (session.revokedAt || session.expiresAt <= now) {
    throw inactiveSession();
  }

  if (session.expiresAt.getTime() - now.getTime() > SESSION_REFRESH_THRESHOLD_MS) {
    return toSessionContext(session);
  }

  const expiresAt = new Date(now.getTime() + ANONYMOUS_SESSION_LIFETIME_MS);
  const refreshed = await client.anonymousSession.updateMany({
    where: {
      id: session.id,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    data: { expiresAt },
  });
  if (refreshed.count !== 1) {
    throw inactiveSession();
  }

  return {
    id: session.id,
    createdAt: session.createdAt,
    expiresAt,
  };
};

export const getBoardAccessSecret = (env: NodeJS.ProcessEnv = process.env) =>
  getServerSecret({
    env,
    name: "BOARD_ACCESS_SECRET",
    developmentFallback: DEVELOPMENT_SECRET,
  });

export const deriveSessionCredentialHash = (
  visitorPayload: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (!VERIFIED_VISITOR_PAYLOAD_PATTERN.test(visitorPayload)) {
    throw new Error("A verified visitor token payload is required for anonymous sessions");
  }

  return hmacSha256(
    getBoardAccessSecret(env),
    `anonymous-session:v1\0${visitorPayload}`,
  );
};

export const resolveOrCreateAnonymousSession = async (
  visitorPayload: string,
  {
    client = prisma,
    env = process.env,
    now = new Date(),
  }: SessionServiceOptions = {},
) => {
  const credentialHash = deriveSessionCredentialHash(visitorPayload, env);
  const session = await client.anonymousSession.upsert({
    where: { credentialHash },
    create: {
      credentialHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ANONYMOUS_SESSION_LIFETIME_MS),
    },
    update: {},
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  return assertAndRefreshSession(client, session, now);
};

export const requireActiveAnonymousSession = async (
  visitorPayload: string,
  {
    client = prisma,
    env = process.env,
    now = new Date(),
  }: SessionServiceOptions = {},
) => {
  const credentialHash = deriveSessionCredentialHash(visitorPayload, env);
  const session = await client.anonymousSession.findUnique({
    where: { credentialHash },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });

  if (!session) {
    throw inactiveSession();
  }

  return assertAndRefreshSession(client, session, now);
};

export const listAccessibleBoards = async (
  visitorPayload: string,
  {
    client = prisma,
    env = process.env,
    now = new Date(),
  }: SessionServiceOptions = {},
): Promise<AccessibleBoardSummary[]> => {
  const session = await requireActiveAnonymousSession(visitorPayload, {
    client,
    env,
    now,
  });
  const memberships = await client.boardMembership.findMany({
    where: {
      sessionId: session.id,
      revokedAt: null,
      board: { expiresAt: { gt: now } },
    },
    orderBy: [
      { board: { createdAt: "desc" } },
      { boardId: "asc" },
    ],
    select: {
      role: true,
      board: {
        select: {
          id: true,
          title: true,
          createdAt: true,
          expiresAt: true,
        },
      },
    },
  });

  return memberships.map(({ board, role }) => ({
    id: board.id,
    title: board.title,
    role,
    createdAt: board.createdAt.toISOString(),
    expiresAt: board.expiresAt.toISOString(),
  }));
};

export const preserveAnonymousSessionForCredentialRefresh = async (
  visitorPayload: string,
  {
    client = prisma,
    env = process.env,
    now = new Date(),
  }: SessionServiceOptions = {},
) => {
  const credentialHash = deriveSessionCredentialHash(visitorPayload, env);
  const credentialHorizon = new Date(
    now.getTime() + ANONYMOUS_CREDENTIAL_LIFETIME_DAYS * 24 * 60 * 60 * 1000,
  );
  const tombstoneHorizon = new Date(now.getTime() + ANONYMOUS_SESSION_LIFETIME_MS);

  const preserved = await client.anonymousSession.updateMany({
    where: {
      credentialHash,
      expiresAt: { lt: credentialHorizon },
    },
    data: { expiresAt: tombstoneHorizon },
  });

  return preserved.count;
};

export const getOrCreateSessionInTransaction = (
  tx: Prisma.TransactionClient,
  visitorPayload: string,
  options: Omit<SessionServiceOptions, "client"> = {},
) => resolveOrCreateAnonymousSession(visitorPayload, { ...options, client: tx });

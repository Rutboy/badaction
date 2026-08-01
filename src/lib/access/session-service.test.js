import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveSessionCredentialHash,
  getBoardAccessSecret,
  preserveAnonymousSessionForCredentialRefresh,
  requireActiveAnonymousSession,
  resolveOrCreateAnonymousSession,
} from "./session-service.ts";

const ENV = {
  NODE_ENV: "test",
  BOARD_ACCESS_SECRET: "unit-test-board-access-secret-1234567890",
};

test("derives stable pseudonymous session credentials", () => {
  const first = "A".repeat(43);
  const second = "B".repeat(43);
  const firstHash = deriveSessionCredentialHash(first, ENV);

  assert.equal(firstHash, deriveSessionCredentialHash(first, ENV));
  assert.notEqual(firstHash, deriveSessionCredentialHash(second, ENV));
  assert.doesNotMatch(firstHash, new RegExp(first));
  assert.throws(() => deriveSessionCredentialHash("invalid payload", ENV), /verified visitor/);
});

test("requires a strong dedicated access secret in production", () => {
  assert.equal(getBoardAccessSecret(ENV), ENV.BOARD_ACCESS_SECRET);
  assert.throws(
    () => getBoardAccessSecret({ NODE_ENV: "production", BOARD_ACCESS_SECRET: "short" }),
    /BOARD_ACCESS_SECRET/,
  );
});

test("creates anonymous sessions with a safety margin beyond the 400-day credential", async () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  let createData;
  const client = {
    anonymousSession: {
      upsert: async ({ create }) => {
        createData = create;
        return {
          id: "session-id",
          createdAt: create.createdAt,
          expiresAt: create.expiresAt,
          revokedAt: null,
        };
      },
    },
  };

  const session = await resolveOrCreateAnonymousSession("C".repeat(43), {
    client,
    env: ENV,
    now,
  });

  assert.equal(
    session.expiresAt.getTime() - now.getTime(),
    401 * 24 * 60 * 60 * 1000,
  );
  assert.equal(createData.expiresAt.toISOString(), session.expiresAt.toISOString());
});

test("refreshes an active session before it can expire ahead of a board", async () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  const existingExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  let refreshedExpiry;
  const client = {
    anonymousSession: {
      findUnique: async () => ({
        id: "session-id",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        expiresAt: existingExpiry,
        revokedAt: null,
      }),
      updateMany: async ({ data }) => {
        refreshedExpiry = data.expiresAt;
        return { count: 1 };
      },
    },
  };

  const session = await requireActiveAnonymousSession("D".repeat(43), {
    client,
    env: ENV,
    now,
  });

  assert.equal(
    session.expiresAt.getTime() - now.getTime(),
    401 * 24 * 60 * 60 * 1000,
  );
  assert.equal(refreshedExpiry.toISOString(), session.expiresAt.toISOString());
});

test("credential refresh extends a revoked tombstone without reactivating it", async () => {
  const now = new Date("2026-07-31T12:00:00.000Z");
  let update;
  const client = {
    anonymousSession: {
      updateMany: async (input) => {
        update = input;
        return { count: 1 };
      },
    },
  };

  await preserveAnonymousSessionForCredentialRefresh("E".repeat(43), {
    client,
    env: ENV,
    now,
  });

  assert.equal(update.where.revokedAt, undefined);
  assert.equal(
    update.where.expiresAt.lt.getTime() - now.getTime(),
    400 * 24 * 60 * 60 * 1000,
  );
  assert.equal(
    update.data.expiresAt.getTime() - now.getTime(),
    401 * 24 * 60 * 60 * 1000,
  );
});

test("replaying an aging cookie cannot keep rewriting its tombstone", async () => {
  const firstRequest = new Date("2026-07-31T12:00:00.000Z");
  let storedExpiry = new Date(firstRequest.getTime() + 30 * 24 * 60 * 60 * 1000);
  let actualUpdates = 0;
  const client = {
    anonymousSession: {
      updateMany: async ({ where, data }) => {
        if (storedExpiry < where.expiresAt.lt) {
          storedExpiry = data.expiresAt;
          actualUpdates += 1;
          return { count: 1 };
        }
        return { count: 0 };
      },
    },
  };

  const first = await preserveAnonymousSessionForCredentialRefresh("F".repeat(43), {
    client,
    env: ENV,
    now: firstRequest,
  });
  const replay = await preserveAnonymousSessionForCredentialRefresh("F".repeat(43), {
    client,
    env: ENV,
    now: new Date(firstRequest.getTime() + 60 * 60 * 1000),
  });

  assert.equal(first, 1);
  assert.equal(replay, 0);
  assert.equal(actualUpdates, 1);
});

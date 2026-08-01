import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  cleanupExpiredData,
  RETENTION_CLEANUP_SCHEDULE_KEY,
} from "./retention-cleanup-service.ts";

class FakeLockClient extends EventEmitter {
  constructor(acquired, { intervalClaimed = true } = {}) {
    super();
    this.acquired = acquired;
    this.intervalClaimed = intervalClaimed;
    this.connectCalls = 0;
    this.endCalls = 0;
    this.queries = [];
  }

  async connect() {
    this.connectCalls += 1;
  }

  async query(queryText, values) {
    this.queries.push({ queryText, values });
    if (queryText.includes("pg_try_advisory_lock")) {
      return { rows: [{ acquired: this.acquired }] };
    }
    if (queryText.includes('INSERT INTO "rate_limit_buckets"')) {
      return {
        rows: this.intervalClaimed
          ? [{ key: RETENTION_CLEANUP_SCHEDULE_KEY }]
          : [],
      };
    }
    return { rows: [] };
  }

  async end() {
    this.endCalls += 1;
  }
}

const createFakePrisma = ({
  boardIds = [],
  deleteBoards = false,
  poisonBoardId,
} = {}) => {
  const executedSql = [];
  const executedQueries = [];
  let transactionCalls = 0;
  const tx = {
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      executedSql.push(sql);
      executedQueries.push({ sql, values });
      return [];
    },
    $executeRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      executedSql.push(sql);
      executedQueries.push({ sql, values });
      if (
        poisonBoardId &&
        values.includes(poisonBoardId) &&
        sql.includes('FROM "invitation_redemptions"')
      ) {
        throw new Error("poison board");
      }
      return sql.includes('DELETE FROM "boards"') && deleteBoards ? 1 : 0;
    },
  };
  return {
    executedSql,
    executedQueries,
    get transactionCalls() {
      return transactionCalls;
    },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join("?");
      executedSql.push(sql);
      executedQueries.push({ sql, values });
      return boardIds.map((id) => ({ id }));
    },
    $transaction: async (callback) => {
      transactionCalls += 1;
      return callback(tx);
    },
  };
};

test("cleanup holds and releases one session advisory lock around all steps", async () => {
  const lockClient = new FakeLockClient(true);
  const prisma = createFakePrisma();

  const result = await cleanupExpiredData({
    prisma,
    minimumIntervalMs: 0,
    createLockClient: () => lockClient,
  });

  assert.equal(result.advisoryLockAcquired, true);
  assert.equal(result.skipReason, null);
  assert.equal(result.aborted, false);
  assert.equal(prisma.transactionCalls, 2);
  assert.equal(lockClient.connectCalls, 1);
  assert.equal(lockClient.endCalls, 1);
  assert.equal(lockClient.queries.length, 2);
  assert.match(lockClient.queries[0].queryText, /pg_try_advisory_lock/);
  assert.match(lockClient.queries[1].queryText, /pg_advisory_unlock/);

  const sessionSql = prisma.executedSql.at(-1);
  assert.match(sessionSql, /anonymous_sessions/);
  assert.match(sessionSql, /expires_at.*CURRENT_TIMESTAMP/s);
  assert.doesNotMatch(sessionSql, /revoked_at/);

  const bucketCleanup = prisma.executedQueries.find(({ sql }) =>
    sql.includes('DELETE FROM "rate_limit_buckets"'),
  );
  assert.ok(bucketCleanup);
  assert.match(bucketCleanup.sql, /AND "key" <> \?/);
  assert.ok(bucketCleanup.values.includes(RETENTION_CLEANUP_SCHEDULE_KEY));
});

test("cleanup skips all destructive work when another instance owns the lock", async () => {
  const lockClient = new FakeLockClient(false);
  const prisma = createFakePrisma();

  const result = await cleanupExpiredData({
    prisma,
    createLockClient: () => lockClient,
  });

  assert.equal(result.advisoryLockAcquired, false);
  assert.equal(result.skipReason, "advisory-lock");
  assert.equal(prisma.transactionCalls, 0);
  assert.equal(prisma.executedSql.length, 0);
  assert.equal(lockClient.queries.length, 1);
  assert.equal(lockClient.endCalls, 1);
});

test("global interval claim skips a later replica without destructive work", async () => {
  const lockClient = new FakeLockClient(true, { intervalClaimed: false });
  const prisma = createFakePrisma();

  const result = await cleanupExpiredData({
    prisma,
    minimumIntervalMs: 60_000,
    createLockClient: () => lockClient,
  });

  assert.equal(result.advisoryLockAcquired, true);
  assert.equal(result.skipReason, "minimum-interval");
  assert.equal(prisma.transactionCalls, 0);
  assert.equal(prisma.executedSql.length, 0);
  assert.equal(lockClient.queries.length, 3);
  assert.match(lockClient.queries[1].queryText, /ON CONFLICT/);
  assert.match(lockClient.queries[1].queryText, /\$1,\s*1,/s);
  assert.match(lockClient.queries[1].queryText, /"count" = 1/);
  assert.deepEqual(lockClient.queries[1].values, [
    RETENTION_CLEANUP_SCHEDULE_KEY,
    60_000,
  ]);
  assert.match(lockClient.queries[2].queryText, /pg_advisory_unlock/);
});

test("a successful interval claim runs cleanup and advances the marker", async () => {
  const lockClient = new FakeLockClient(true);
  const prisma = createFakePrisma();

  const result = await cleanupExpiredData({
    prisma,
    minimumIntervalMs: 60_000,
    createLockClient: () => lockClient,
  });

  assert.equal(result.skipReason, null);
  assert.equal(prisma.transactionCalls, 2);
  assert.equal(lockClient.queries.length, 3);
  assert.match(lockClient.queries[1].queryText, /RETURNING "key"/);
});

test("cleanup rejects unsafe global interval values before connecting", async () => {
  const prisma = createFakePrisma();
  for (const minimumIntervalMs of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      cleanupExpiredData({ prisma, minimumIntervalMs }),
      /non-negative integer/,
    );
  }
});

test("expired board chunks include the dynamic-domain child tables", async () => {
  const lockClient = new FakeLockClient(true);
  const prisma = createFakePrisma({
    boardIds: ["11111111-1111-4111-8111-111111111111"],
  });

  const result = await cleanupExpiredData({
    prisma,
    createLockClient: () => lockClient,
  });

  assert.equal(result.boardCleanupChunks, 1);
  assert.equal(result.boardCandidatesDeferred, 1);
  const cleanupSql = prisma.executedSql.join("\n");
  assert.match(cleanupSql, /action_items/);
  assert.match(cleanupSql, /card_groups/);
  assert.match(cleanupSql, /board_columns/);
});

test("one poison board does not prevent later parents or bulk classes", async () => {
  const poisonBoardId = "11111111-1111-4111-8111-111111111111";
  const healthyBoardId = "22222222-2222-4222-8222-222222222222";
  const lockClient = new FakeLockClient(true);
  const prisma = createFakePrisma({
    boardIds: [poisonBoardId, healthyBoardId],
    deleteBoards: true,
    poisonBoardId,
  });

  const result = await cleanupExpiredData({
    prisma,
    createLockClient: () => lockClient,
  });

  assert.equal(result.boardDeleteFailures, 1);
  assert.equal(result.boardsDeleted, 1);
  assert.equal(result.anonymousSessionsDeleted, 0);
  assert.equal(prisma.transactionCalls, 4);
});

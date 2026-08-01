import type { PrismaClient } from "@prisma/client";
import { Client } from "pg";
import {
  DEFAULT_RETENTION_CLEANUP_BATCH_SIZE,
  MAX_RETENTION_CLEANUP_BATCH_SIZE,
} from "../config/retention-cleanup.ts";

const BOARD_CHILD_DELETE_BATCH_SIZE = 10000;
const BOARD_CLEANUP_BUDGET_MS = 4 * 60 * 1000;
const BOARD_DELETE_STATEMENT_TIMEOUT = "4s";
const BOARD_DELETE_TRANSACTION_TIMEOUT_MS = 15000;
const BULK_STATEMENT_TIMEOUT = "18s";
const BULK_TRANSACTION_TIMEOUT_MS = 25000;

// The two-int namespace avoids sharing a lock with unrelated application jobs.
// 0x62616461 / 0x6374696f spell "bada" / "ctio" in ASCII.
const RETENTION_ADVISORY_LOCK_CLASS = 0x62616461;
const RETENTION_ADVISORY_LOCK_OBJECT = 0x6374696f;
export const RETENTION_CLEANUP_SCHEDULE_KEY =
  "system:retention-cleanup-schedule";

type RetentionAdvisoryLockClient = Pick<
  Client,
  "connect" | "query" | "end" | "on" | "off"
>;

export type RetentionCleanupResult = {
  advisoryLockAcquired: boolean;
  skipReason: "advisory-lock" | "minimum-interval" | null;
  aborted: boolean;
  boardsDeleted: number;
  boardDeleteFailures: number;
  boardCleanupChunks: number;
  boardCandidatesDeferred: number;
  rateLimitBucketsDeleted: number;
  anonymousSessionsDeleted: number;
  failedSteps: string[];
};

type CleanupExpiredDataOptions = {
  prisma: PrismaClient;
  batchSize?: number;
  signal?: AbortSignal;
  minimumIntervalMs?: number;
  now?: () => number;
  createLockClient?: () => RetentionAdvisoryLockClient;
};

const createEmptyResult = (
  advisoryLockAcquired: boolean,
  aborted = false,
  skipReason: RetentionCleanupResult["skipReason"] = null,
): RetentionCleanupResult => ({
  advisoryLockAcquired,
  skipReason,
  aborted,
  boardsDeleted: 0,
  boardDeleteFailures: 0,
  boardCleanupChunks: 0,
  boardCandidatesDeferred: 0,
  rateLimitBucketsDeleted: 0,
  anonymousSessionsDeleted: 0,
  failedSteps: [],
});

export const assertRetentionCleanupBatchSize = (batchSize: number): void => {
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_RETENTION_CLEANUP_BATCH_SIZE
  ) {
    throw new Error(
      `batchSize must be an integer between 1 and ${MAX_RETENTION_CLEANUP_BATCH_SIZE}`,
    );
  }
};

const createDefaultLockClient = (): RetentionAdvisoryLockClient =>
  new Client({
    connectionString: process.env.DATABASE_URL,
    application_name: "badaction-retention-cleanup",
    connectionTimeoutMillis: 10_000,
    query_timeout: 10_000,
    keepAlive: true,
  });

const runCleanupWithoutLock = async ({
  prisma,
  batchSize,
  signal,
  now,
}: Required<Pick<CleanupExpiredDataOptions, "prisma" | "batchSize" | "now">> &
  Pick<
    CleanupExpiredDataOptions,
    "signal"
  >): Promise<RetentionCleanupResult> => {
  const result = createEmptyResult(true);

  if (!signal?.aborted) {
    try {
      result.rateLimitBucketsDeleted = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT set_config(
              'statement_timeout',
              ${BULK_STATEMENT_TIMEOUT},
              true
            )
          `;
          return tx.$executeRaw`
            WITH expired AS (
              SELECT "key"
              FROM "rate_limit_buckets"
              WHERE "reset_at" <= CURRENT_TIMESTAMP
                AND "key" <> ${RETENTION_CLEANUP_SCHEDULE_KEY}
              ORDER BY "reset_at" ASC
              LIMIT ${batchSize}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "rate_limit_buckets" AS bucket
            USING expired
            WHERE bucket."key" = expired."key"
          `;
        },
        { maxWait: 5000, timeout: BULK_TRANSACTION_TIMEOUT_MS },
      );
    } catch {
      result.failedSteps.push("rate-limit-buckets");
    }
  }

  let boardCandidates: Array<{ id: string }> = [];
  if (!signal?.aborted) {
    try {
      boardCandidates = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "boards"
        WHERE "expires_at" <= CURRENT_TIMESTAMP
        ORDER BY "expires_at" ASC, "id" ASC
        LIMIT ${batchSize}
      `;
    } catch {
      result.failedSteps.push("board-candidates");
    }
  }

  const boardQueue = [...boardCandidates];
  const boardCleanupDeadline = now() + BOARD_CLEANUP_BUDGET_MS;
  while (
    boardQueue.length > 0 &&
    !signal?.aborted &&
    now() < boardCleanupDeadline
  ) {
    const board = boardQueue.shift();
    if (!board) {
      break;
    }

    try {
      const cleanupChunk = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT set_config(
              'statement_timeout',
              ${BOARD_DELETE_STATEMENT_TIMEOUT},
              true
            )
          `;
          const redemptionsDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT "id"
              FROM "invitation_redemptions"
              WHERE "board_id" = ${board.id}::uuid
              ORDER BY "id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "invitation_redemptions" AS redemption
            USING doomed
            WHERE redemption."id" = doomed."id"
          `;
          const votesDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT "id"
              FROM "votes"
              WHERE "board_id" = ${board.id}::uuid
              ORDER BY "id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "votes" AS vote
            USING doomed
            WHERE vote."id" = doomed."id"
          `;
          const actionItemsDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT "id"
              FROM "action_items"
              WHERE "board_id" = ${board.id}::uuid
              ORDER BY "id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "action_items" AS action_item
            USING doomed
            WHERE action_item."id" = doomed."id"
          `;
          // Cards and groups intentionally reference each other. Break the
          // cycle in bounded chunks before deleting either side. The board is
          // expired, so clearing placement cannot expose active product state.
          const groupedCardsUnlinked = await tx.$executeRaw`
            WITH doomed AS (
              SELECT "id"
              FROM "cards"
              WHERE "board_id" = ${board.id}::uuid
                AND "group_id" IS NOT NULL
              ORDER BY "id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            UPDATE "cards" AS card
            SET
              "group_id" = NULL,
              "group_position" = NULL
            FROM doomed
            WHERE card."id" = doomed."id"
          `;
          const cardGroupsDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT card_group."id"
              FROM "card_groups" AS card_group
              WHERE card_group."board_id" = ${board.id}::uuid
                AND NOT EXISTS (
                  SELECT 1
                  FROM "cards" AS card
                  WHERE card."group_id" = card_group."id"
                )
              ORDER BY card_group."id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "card_groups" AS card_group
            USING doomed
            WHERE card_group."id" = doomed."id"
          `;
          const cardsDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT card."id"
              FROM "cards" AS card
              WHERE card."board_id" = ${board.id}::uuid
                AND card."group_id" IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM "votes" AS vote
                  WHERE vote."card_id" = card."id"
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "card_groups" AS card_group
                  WHERE card_group."primary_card_id" = card."id"
                )
              ORDER BY card."id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "cards" AS card
            USING doomed
            WHERE card."id" = doomed."id"
          `;
          const invitationsDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT invitation."id"
              FROM "board_invitations" AS invitation
              WHERE invitation."board_id" = ${board.id}::uuid
                AND NOT EXISTS (
                  SELECT 1
                  FROM "invitation_redemptions" AS redemption
                  WHERE redemption."invitation_id" = invitation."id"
                )
              ORDER BY invitation."id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "board_invitations" AS invitation
            USING doomed
            WHERE invitation."id" = doomed."id"
          `;
          const membershipsDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT membership."id"
              FROM "board_memberships" AS membership
              WHERE membership."board_id" = ${board.id}::uuid
                AND NOT EXISTS (
                  SELECT 1
                  FROM "invitation_redemptions" AS redemption
                  WHERE redemption."membership_id" = membership."id"
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "cards" AS card
                  WHERE card."created_by_membership_id" = membership."id"
                )
              ORDER BY membership."id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "board_memberships" AS membership
            USING doomed
            WHERE membership."id" = doomed."id"
          `;
          const boardColumnsDeleted = await tx.$executeRaw`
            WITH doomed AS (
              SELECT board_column."id"
              FROM "board_columns" AS board_column
              WHERE board_column."board_id" = ${board.id}::uuid
                AND NOT EXISTS (
                  SELECT 1
                  FROM "cards" AS card
                  WHERE card."column_id" = board_column."id"
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "card_groups" AS card_group
                  WHERE card_group."column_id" = board_column."id"
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "votes" AS vote
                  WHERE vote."column_id" = board_column."id"
                )
              ORDER BY board_column."id"
              LIMIT ${BOARD_CHILD_DELETE_BATCH_SIZE}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "board_columns" AS board_column
            USING doomed
            WHERE board_column."id" = doomed."id"
          `;
          const boardsDeleted = await tx.$executeRaw`
            DELETE FROM "boards" AS board
            WHERE board."id" = ${board.id}::uuid
              AND board."expires_at" <= CURRENT_TIMESTAMP
              AND NOT EXISTS (
                SELECT 1 FROM "cards" WHERE "board_id" = board."id"
              )
              AND NOT EXISTS (
                SELECT 1 FROM "board_memberships" WHERE "board_id" = board."id"
              )
              AND NOT EXISTS (
                SELECT 1 FROM "board_invitations" WHERE "board_id" = board."id"
              )
              AND NOT EXISTS (
                SELECT 1 FROM "votes" WHERE "board_id" = board."id"
              )
              AND NOT EXISTS (
                SELECT 1 FROM "card_groups" WHERE "board_id" = board."id"
              )
              AND NOT EXISTS (
                SELECT 1 FROM "action_items" WHERE "board_id" = board."id"
              )
              AND NOT EXISTS (
                SELECT 1 FROM "board_columns" WHERE "board_id" = board."id"
              )
          `;

          return {
            boardsDeleted,
            childRowsDeleted:
              redemptionsDeleted +
              votesDeleted +
              actionItemsDeleted +
              groupedCardsUnlinked +
              cardGroupsDeleted +
              cardsDeleted +
              invitationsDeleted +
              membershipsDeleted +
              boardColumnsDeleted,
          };
        },
        { maxWait: 1000, timeout: BOARD_DELETE_TRANSACTION_TIMEOUT_MS },
      );
      result.boardCleanupChunks += 1;
      result.boardsDeleted += cleanupChunk.boardsDeleted;
      if (cleanupChunk.boardsDeleted === 0) {
        if (
          cleanupChunk.childRowsDeleted > 0 &&
          !signal?.aborted &&
          now() < boardCleanupDeadline
        ) {
          boardQueue.push(board);
        } else {
          result.boardCandidatesDeferred += 1;
        }
      }
    } catch {
      // Board UUIDs are bearer locators and must not be written to logs.
      result.boardDeleteFailures += 1;
    }
  }
  result.boardCandidatesDeferred += boardQueue.length;

  if (!signal?.aborted) {
    try {
      result.anonymousSessionsDeleted = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT set_config(
              'statement_timeout',
              ${BULK_STATEMENT_TIMEOUT},
              true
            )
          `;
          return tx.$executeRaw`
            WITH expired AS (
              SELECT session."id"
              FROM "anonymous_sessions" AS session
              WHERE session."expires_at" <= CURRENT_TIMESTAMP
                AND NOT EXISTS (
                  SELECT 1
                  FROM "board_memberships" AS membership
                  WHERE membership."session_id" = session."id"
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM "board_invitations" AS invitation
                  WHERE invitation."created_by_session_id" = session."id"
                )
              ORDER BY session."expires_at" ASC, session."id" ASC
              LIMIT ${batchSize}
              FOR UPDATE SKIP LOCKED
            )
            DELETE FROM "anonymous_sessions" AS session
            USING expired
            WHERE session."id" = expired."id"
          `;
        },
        { maxWait: 5000, timeout: BULK_TRANSACTION_TIMEOUT_MS },
      );
    } catch {
      result.failedSteps.push("anonymous-sessions");
    }
  }

  result.aborted = signal?.aborted ?? false;
  return result;
};

export const cleanupExpiredData = async ({
  prisma,
  batchSize = DEFAULT_RETENTION_CLEANUP_BATCH_SIZE,
  signal,
  minimumIntervalMs,
  now = Date.now,
  createLockClient = createDefaultLockClient,
}: CleanupExpiredDataOptions): Promise<RetentionCleanupResult> => {
  assertRetentionCleanupBatchSize(batchSize);
  if (
    minimumIntervalMs !== undefined &&
    (!Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 0)
  ) {
    throw new Error("minimumIntervalMs must be a non-negative integer");
  }
  if (signal?.aborted) {
    return createEmptyResult(false, true);
  }

  const lockClient = createLockClient();
  const cleanupAbortController = new AbortController();
  let advisoryLockAcquired = false;
  let lockConnectionFailed = false;
  const forwardAbort = () => cleanupAbortController.abort(signal?.reason);
  const handleLockError = () => {
    lockConnectionFailed = true;
    cleanupAbortController.abort();
  };

  signal?.addEventListener("abort", forwardAbort, { once: true });
  lockClient.on("error", handleLockError);
  try {
    await lockClient.connect();
    const lockResult = await lockClient.query<{ acquired: boolean }>(
      `SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired`,
      [RETENTION_ADVISORY_LOCK_CLASS, RETENTION_ADVISORY_LOCK_OBJECT],
    );
    advisoryLockAcquired = lockResult.rows[0]?.acquired === true;
    if (!advisoryLockAcquired) {
      return createEmptyResult(
        false,
        cleanupAbortController.signal.aborted,
        "advisory-lock",
      );
    }

    if (minimumIntervalMs !== undefined && minimumIntervalMs > 0) {
      const claimResult = await lockClient.query<{ key: string }>(
        `
          INSERT INTO "rate_limit_buckets" ("key", "count", "reset_at")
          VALUES (
            $1,
            1,
            CURRENT_TIMESTAMP + ($2::double precision * INTERVAL '1 millisecond')
          )
          ON CONFLICT ("key") DO UPDATE
          SET
            "count" = 1,
            "reset_at" = EXCLUDED."reset_at"
          WHERE "rate_limit_buckets"."reset_at" <= CURRENT_TIMESTAMP
          RETURNING "key"
        `,
        [RETENTION_CLEANUP_SCHEDULE_KEY, minimumIntervalMs],
      );
      if (claimResult.rows.length === 0) {
        return createEmptyResult(true, false, "minimum-interval");
      }
    }

    const result = await runCleanupWithoutLock({
      prisma,
      batchSize,
      signal: cleanupAbortController.signal,
      now,
    });
    if (lockConnectionFailed) {
      throw new Error("Retention cleanup advisory lock connection was lost");
    }
    return result;
  } finally {
    signal?.removeEventListener("abort", forwardAbort);
    if (advisoryLockAcquired && !lockConnectionFailed) {
      await lockClient
        .query(`SELECT pg_advisory_unlock($1::integer, $2::integer)`, [
          RETENTION_ADVISORY_LOCK_CLASS,
          RETENTION_ADVISORY_LOCK_OBJECT,
        ])
        .catch(() => undefined);
    }
    lockClient.off("error", handleLockError);
    await lockClient.end().catch(() => undefined);
  }
};

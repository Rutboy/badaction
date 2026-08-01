import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ApiError } from "../errors/api-error-base.ts";
import { prisma } from "../prisma/client.ts";

const DEFAULT_CLEANUP_BATCH_SIZE = 1000;
const MAX_CLEANUP_BATCH_SIZE = 10000;
const OPPORTUNISTIC_CLEANUP_BATCH_SIZE = 25;
const MAX_RATE_LIMIT = 1_000_000;
const MAX_INTERVAL_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_KEY_LENGTH = 4096;

type BucketResult = {
  count: number;
  resetAt: Date;
};

const assertIntegerInRange = (
  value: number,
  name: string,
  min: number,
  max: number,
): void => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer between ${min} and ${max}`);
  }
};

const hashKey = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");

export const assertRateLimit = async (
  key: string,
  limit: number,
  intervalMs: number,
): Promise<void> => {
  if (key.length < 1 || key.length > MAX_KEY_LENGTH) {
    throw new RangeError(`key length must be between 1 and ${MAX_KEY_LENGTH}`);
  }

  assertIntegerInRange(limit, "limit", 1, MAX_RATE_LIMIT);
  assertIntegerInRange(intervalMs, "intervalMs", 1, MAX_INTERVAL_MS);

  const bucketKey = hashKey(key);
  const buckets = await prisma.$queryRaw<BucketResult[]>(Prisma.sql`
    WITH expired AS (
      SELECT "key"
      FROM "rate_limit_buckets"
      WHERE "reset_at" <= CURRENT_TIMESTAMP
        AND "key" <> ${bucketKey}
      ORDER BY "reset_at"
      LIMIT ${OPPORTUNISTIC_CLEANUP_BATCH_SIZE}
      FOR UPDATE SKIP LOCKED
    ),
    cleaned AS (
      DELETE FROM "rate_limit_buckets" AS bucket
      USING expired
      WHERE bucket."key" = expired."key"
    )
    INSERT INTO "rate_limit_buckets" AS bucket ("key", "count", "reset_at")
    VALUES (
      ${bucketKey},
      1,
      CURRENT_TIMESTAMP + (${intervalMs} * INTERVAL '1 millisecond')
    )
    ON CONFLICT ("key") DO UPDATE
    SET
      "count" = CASE
        WHEN bucket."reset_at" <= CURRENT_TIMESTAMP THEN 1
        ELSE LEAST(bucket."count" + 1, ${limit + 1})
      END,
      "reset_at" = CASE
        WHEN bucket."reset_at" <= CURRENT_TIMESTAMP
          THEN CURRENT_TIMESTAMP + (${intervalMs} * INTERVAL '1 millisecond')
        ELSE bucket."reset_at"
      END
    RETURNING "count", "reset_at" AS "resetAt"
  `);

  const bucket = buckets[0];
  if (!bucket) {
    throw new Error("Rate limit bucket update returned no row");
  }

  if (bucket.count > limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt.getTime() - Date.now()) / 1000),
    );

    throw new ApiError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Слишком много запросов. Попробуйте позже.",
      { retryAfterSeconds },
    );
  }
};

export const cleanupExpiredRateLimitBuckets = async (
  batchSize = DEFAULT_CLEANUP_BATCH_SIZE,
): Promise<number> => {
  assertIntegerInRange(batchSize, "batchSize", 1, MAX_CLEANUP_BATCH_SIZE);

  const deleted = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    WITH expired AS (
      SELECT "key"
      FROM "rate_limit_buckets"
      WHERE "reset_at" <= CURRENT_TIMESTAMP
      ORDER BY "reset_at"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM "rate_limit_buckets" AS bucket
    USING expired
    WHERE bucket."key" = expired."key"
    RETURNING bucket."key"
  `);

  return deleted.length;
};

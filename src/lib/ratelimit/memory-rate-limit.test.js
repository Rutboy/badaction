import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../prisma/client.ts";
import {
  assertRateLimit,
  cleanupExpiredRateLimitBuckets,
} from "./memory-rate-limit.ts";

test("rate limit rejects invalid settings before accessing the database", async () => {
  await assert.rejects(() => assertRateLimit("", 1, 1000), /key length/);
  await assert.rejects(() => assertRateLimit("key", 0, 1000), /limit must be an integer/);
  await assert.rejects(() => assertRateLimit("key", 1, 0), /intervalMs must be an integer/);
  await assert.rejects(() => cleanupExpiredRateLimitBuckets(0), /batchSize must be an integer/);
});

test(
  "PostgreSQL bucket is shared and resets after its interval",
  { skip: process.env.RUN_DATABASE_TESTS !== "1" },
  async () => {
    const key = `integration:${randomUUID()}`;
    const bucketKey = createHash("sha256").update(key, "utf8").digest("hex");
    const intervalMs = 60_000;

    try {
      await assertRateLimit(key, 2, intervalMs);
      await assertRateLimit(key, 2, intervalMs);

      await assert.rejects(
        () => assertRateLimit(key, 2, intervalMs),
        (error) => error?.code === "RATE_LIMIT_EXCEEDED" && error?.status === 429,
      );

      await prisma.rateLimitBucket.update({
        where: { key: bucketKey },
        data: { resetAt: new Date(Date.now() - 1_000) },
      });
      await assertRateLimit(key, 2, intervalMs);
    } finally {
      await prisma.rateLimitBucket.deleteMany({ where: { key: bucketKey } });
    }
  },
);

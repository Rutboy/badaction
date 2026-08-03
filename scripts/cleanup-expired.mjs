import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_RETENTION_CLEANUP_BATCH_SIZE,
  MAX_RETENTION_CLEANUP_BATCH_SIZE,
} from "../src/lib/config/retention-cleanup.ts";
import { cleanupExpiredData } from "../src/lib/services/retention-cleanup-service.ts";

export const parseBatchSize = (value) => {
  if (value === undefined) {
    return DEFAULT_RETENTION_CLEANUP_BATCH_SIZE;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(
      `Batch size must be an integer between 1 and ${MAX_RETENTION_CLEANUP_BATCH_SIZE}`,
    );
  }

  const batchSize = Number(value);
  if (
    !Number.isSafeInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MAX_RETENTION_CLEANUP_BATCH_SIZE
  ) {
    throw new Error(
      `Batch size must be an integer between 1 and ${MAX_RETENTION_CLEANUP_BATCH_SIZE}`,
    );
  }

  return batchSize;
};

export const parseCleanupArguments = (args) => {
  if (args.length > 1) {
    throw new Error("Expected at most one batch-size argument");
  }

  return parseBatchSize(args[0]);
};

const runCleanup = async () => {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  try {
    const batchSize = parseCleanupArguments(process.argv.slice(2));
    const result = await cleanupExpiredData({ prisma, batchSize });

    console.log(JSON.stringify(result));
    if (
      result.failedSteps.length > 0 ||
      result.boardDeleteFailures > 0 ||
      result.aborted
    ) {
      console.error(
        `Expired-data cleanup incomplete: ${result.failedSteps.length} failed steps, ${result.boardDeleteFailures} board deletes deferred`,
      );
      process.exitCode = 1;
    }
  } catch {
    console.error("Expired-data cleanup failed");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectRun =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  await runCleanup();
}

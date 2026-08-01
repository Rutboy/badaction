import { parseIntegerSetting } from "./limits.ts";

export const DEFAULT_RETENTION_CLEANUP_BATCH_SIZE = 1000;
export const MAX_RETENTION_CLEANUP_BATCH_SIZE = 10000;

const DEFAULT_CLEANUP_INTERVAL_MINUTES = 60;
const MAX_CLEANUP_INTERVAL_MINUTES = 24 * 60;

export const getRetentionCleanupIntervalMinutes = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  parseIntegerSetting(env.RETENTION_CLEANUP_INTERVAL_MINUTES, {
    name: "RETENTION_CLEANUP_INTERVAL_MINUTES",
    defaultValue: DEFAULT_CLEANUP_INTERVAL_MINUTES,
    min: 1,
    max: MAX_CLEANUP_INTERVAL_MINUTES,
  });

export const getRetentionCleanupBatchSize = (
  env: NodeJS.ProcessEnv = process.env,
): number =>
  parseIntegerSetting(env.RETENTION_CLEANUP_BATCH_SIZE, {
    name: "RETENTION_CLEANUP_BATCH_SIZE",
    defaultValue: DEFAULT_RETENTION_CLEANUP_BATCH_SIZE,
    min: 1,
    max: MAX_RETENTION_CLEANUP_BATCH_SIZE,
  });

export const isRetentionCleanupEnabled = (
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  const value = env.RETENTION_CLEANUP_ENABLED;
  if (value === undefined || value === "1" || value === "true") {
    return true;
  }
  if (value === "0" || value === "false") {
    return false;
  }
  throw new Error(
    "RETENTION_CLEANUP_ENABLED must be one of: 0, 1, false, true",
  );
};

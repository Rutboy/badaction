import { getBoardCardLimit, getBoardRetentionDays } from "../config/limits.ts";
import { getBoardAccessSecret } from "../access/session-service.ts";
import { getVisitorTokenSecret } from "../cookies/visitor-token-core.ts";
import { getCanonicalAppOrigin } from "./app-origin.ts";
import { getRateLimitKeySecret, parseTrustedProxyHops } from "./client-ip.ts";
import {
  getRetentionCleanupBatchSize,
  getRetentionCleanupIntervalMinutes,
  isRetentionCleanupEnabled,
} from "../config/retention-cleanup.ts";

export const validateRuntimeConfiguration = (
  requestUrl: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required");
  }

  getCanonicalAppOrigin(requestUrl, env);
  getBoardAccessSecret(env);
  getVisitorTokenSecret(env);
  getRateLimitKeySecret(env);
  parseTrustedProxyHops(env.TRUSTED_PROXY_HOPS);
  getBoardRetentionDays(env);
  getBoardCardLimit(env);
  isRetentionCleanupEnabled(env);
  getRetentionCleanupIntervalMinutes(env);
  getRetentionCleanupBatchSize(env);
};

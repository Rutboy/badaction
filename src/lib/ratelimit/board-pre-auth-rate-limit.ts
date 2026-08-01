import { getTrustedProxyRateLimitIdentity } from "../http/client-ip.ts";
import { assertRateLimit } from "./memory-rate-limit.ts";

export const BOARD_PRE_AUTH_TRUSTED_IP_LIMIT = 3_000;
export const BOARD_PRE_AUTH_INTERVAL_MS = 60 * 1000;

type RateLimitAssertion = (
  key: string,
  limit: number,
  intervalMs: number,
) => Promise<void>;

export const assertBoardPreAuthRateLimit = async ({
  headers,
  env = process.env,
  assertLimit = assertRateLimit,
}: {
  headers: Headers;
  env?: NodeJS.ProcessEnv;
  assertLimit?: RateLimitAssertion;
}) => {
  const identity = getTrustedProxyRateLimitIdentity(
    headers,
    "board-pre-auth",
    env,
  );
  if (!identity) {
    return;
  }

  await assertLimit(
    `board-pre-auth:ip:${identity}`,
    BOARD_PRE_AUTH_TRUSTED_IP_LIMIT,
    BOARD_PRE_AUTH_INTERVAL_MS,
  );
};

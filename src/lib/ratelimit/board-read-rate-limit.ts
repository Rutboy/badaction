import {
  getTrustedProxyRateLimitIdentity,
  getVisitorRateLimitIdentity,
} from "../http/client-ip.ts";
import { assertRateLimit } from "./memory-rate-limit.ts";

export const BOARD_READ_VISITOR_LIMIT = 120;
export const BOARD_READ_TRUSTED_IP_LIMIT = 1_200;
export const BOARD_READ_INTERVAL_MS = 60 * 1000;

type RateLimitAssertion = (
  key: string,
  limit: number,
  intervalMs: number,
) => Promise<void>;

export const assertBoardReadRateLimits = async ({
  boardId,
  headers,
  visitorPayload,
  env = process.env,
  assertLimit = assertRateLimit,
}: {
  boardId: string;
  headers: Headers;
  visitorPayload: string;
  env?: NodeJS.ProcessEnv;
  assertLimit?: RateLimitAssertion;
}) => {
  const scope = `board:${boardId}`;
  const ipIdentity = getTrustedProxyRateLimitIdentity(headers, scope, env);
  if (ipIdentity) {
    await assertLimit(
      `read-board:${boardId}:ip:${ipIdentity}`,
      BOARD_READ_TRUSTED_IP_LIMIT,
      BOARD_READ_INTERVAL_MS,
    );
  }

  const visitorIdentity = getVisitorRateLimitIdentity(visitorPayload, scope, env);
  await assertLimit(
    `read-board:${boardId}:visitor:${visitorIdentity}`,
    BOARD_READ_VISITOR_LIMIT,
    BOARD_READ_INTERVAL_MS,
  );
};

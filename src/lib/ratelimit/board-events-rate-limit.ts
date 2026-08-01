import {
  getTrustedProxyRateLimitIdentity,
  getVisitorRateLimitIdentity,
} from "../http/client-ip.ts";
import { assertRateLimit } from "./memory-rate-limit.ts";

export const BOARD_EVENTS_VISITOR_LIMIT = 30;
export const BOARD_EVENTS_TRUSTED_IP_LIMIT = 300;
export const BOARD_EVENTS_INTERVAL_MS = 60 * 1000;

type RateLimitAssertion = (
  key: string,
  limit: number,
  intervalMs: number,
) => Promise<void>;

export const assertBoardEventsRateLimits = async ({
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
}): Promise<void> => {
  const scope = `board:${boardId}`;
  const ipIdentity = getTrustedProxyRateLimitIdentity(headers, scope, env);
  if (ipIdentity) {
    await assertLimit(
      `board-events:${boardId}:ip:${ipIdentity}`,
      BOARD_EVENTS_TRUSTED_IP_LIMIT,
      BOARD_EVENTS_INTERVAL_MS,
    );
  }

  const visitorIdentity = getVisitorRateLimitIdentity(visitorPayload, scope, env);
  await assertLimit(
    `board-events:${boardId}:visitor:${visitorIdentity}`,
    BOARD_EVENTS_VISITOR_LIMIT,
    BOARD_EVENTS_INTERVAL_MS,
  );
};

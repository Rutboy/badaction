import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBoardReadRateLimits,
  BOARD_READ_INTERVAL_MS,
  BOARD_READ_TRUSTED_IP_LIMIT,
  BOARD_READ_VISITOR_LIMIT,
} from "./board-read-rate-limit.ts";

const BOARD_ID = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
const VISITOR_PAYLOAD = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BASE_ENV = {
  NODE_ENV: "test",
  RATE_LIMIT_KEY_SECRET: "unit-test-rate-limit-key-secret",
};

test("board reads always use the board-scoped visitor quota", async () => {
  const calls = [];
  await assertBoardReadRateLimits({
    boardId: BOARD_ID,
    headers: new Headers(),
    visitorPayload: VISITOR_PAYLOAD,
    env: { ...BASE_ENV, TRUSTED_PROXY_HOPS: "0" },
    assertLimit: async (...args) => {
      calls.push(args);
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0][0], new RegExp(`^read-board:${BOARD_ID}:visitor:`));
  assert.equal(calls[0][1], BOARD_READ_VISITOR_LIMIT);
  assert.equal(calls[0][2], BOARD_READ_INTERVAL_MS);
});

test("board reads add the larger trusted-IP abuse cap when configured", async () => {
  const calls = [];
  await assertBoardReadRateLimits({
    boardId: BOARD_ID,
    headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
    visitorPayload: VISITOR_PAYLOAD,
    env: { ...BASE_ENV, TRUSTED_PROXY_HOPS: "1" },
    assertLimit: async (...args) => {
      calls.push(args);
    },
  });

  assert.equal(calls.length, 2);
  assert.match(calls[0][0], new RegExp(`^read-board:${BOARD_ID}:ip:`));
  assert.equal(calls[0][1], BOARD_READ_TRUSTED_IP_LIMIT);
  assert.equal(calls[0][2], BOARD_READ_INTERVAL_MS);
  assert.match(calls[1][0], new RegExp(`^read-board:${BOARD_ID}:visitor:`));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBoardPreAuthRateLimit,
  BOARD_PRE_AUTH_INTERVAL_MS,
  BOARD_PRE_AUTH_TRUSTED_IP_LIMIT,
} from "./board-pre-auth-rate-limit.ts";

const BASE_ENV = {
  NODE_ENV: "test",
  RATE_LIMIT_KEY_SECRET: "unit-test-rate-limit-key-secret",
};

test("pre-auth limiting stays disabled when no trusted proxy is configured", async () => {
  const calls = [];
  await assertBoardPreAuthRateLimit({
    headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
    env: { ...BASE_ENV, TRUSTED_PROXY_HOPS: "0" },
    assertLimit: async (...args) => {
      calls.push(args);
    },
  });

  assert.equal(calls.length, 0);
});

test("pre-auth limiting uses one global trusted-IP bucket for every board path", async () => {
  const calls = [];
  const input = {
    headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
    env: { ...BASE_ENV, TRUSTED_PROXY_HOPS: "1" },
    assertLimit: async (...args) => {
      calls.push(args);
    },
  };

  await assertBoardPreAuthRateLimit(input);
  await assertBoardPreAuthRateLimit(input);

  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], calls[1][0]);
  assert.match(calls[0][0], /^board-pre-auth:ip:[A-Za-z0-9_-]{43}$/);
  assert.equal(calls[0][1], BOARD_PRE_AUTH_TRUSTED_IP_LIMIT);
  assert.equal(calls[0][2], BOARD_PRE_AUTH_INTERVAL_MS);
});

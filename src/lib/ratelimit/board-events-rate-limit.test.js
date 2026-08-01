import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBoardEventsRateLimits,
  BOARD_EVENTS_INTERVAL_MS,
  BOARD_EVENTS_TRUSTED_IP_LIMIT,
  BOARD_EVENTS_VISITOR_LIMIT,
} from "./board-events-rate-limit.ts";

const BOARD_ID = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
const VISITOR_PAYLOAD = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const BASE_ENV = {
  NODE_ENV: "test",
  RATE_LIMIT_KEY_SECRET: "unit-test-rate-limit-key-secret",
};

test("board event handshake constants match the target contract", () => {
  assert.equal(BOARD_EVENTS_VISITOR_LIMIT, 30);
  assert.equal(BOARD_EVENTS_TRUSTED_IP_LIMIT, 300);
  assert.equal(BOARD_EVENTS_INTERVAL_MS, 60_000);
});

test("board event handshakes always consume one board-scoped visitor bucket", async () => {
  const calls = [];
  await assertBoardEventsRateLimits({
    boardId: BOARD_ID,
    headers: new Headers({ "x-forwarded-for": "203.0.113.10" }),
    visitorPayload: VISITOR_PAYLOAD,
    env: { ...BASE_ENV, TRUSTED_PROXY_HOPS: "0" },
    assertLimit: async (...args) => {
      calls.push(args);
    },
  });

  assert.equal(calls.length, 1);
  assert.match(
    calls[0][0],
    new RegExp(`^board-events:${BOARD_ID}:visitor:[A-Za-z0-9_-]{43}$`),
  );
  assert.doesNotMatch(calls[0][0], new RegExp(VISITOR_PAYLOAD));
  assert.equal(calls[0][1], BOARD_EVENTS_VISITOR_LIMIT);
  assert.equal(calls[0][2], BOARD_EVENTS_INTERVAL_MS);
});

test("trusted proxy configuration adds the separate 300 per minute IP cap", async () => {
  const calls = [];
  await assertBoardEventsRateLimits({
    boardId: BOARD_ID,
    headers: new Headers({
      "x-forwarded-for": "attacker-supplied, 203.0.113.10",
    }),
    visitorPayload: VISITOR_PAYLOAD,
    env: { ...BASE_ENV, TRUSTED_PROXY_HOPS: "1" },
    assertLimit: async (...args) => {
      calls.push(args);
    },
  });

  assert.equal(calls.length, 2);
  assert.match(
    calls[0][0],
    new RegExp(`^board-events:${BOARD_ID}:ip:[A-Za-z0-9_-]{43}$`),
  );
  assert.doesNotMatch(calls[0][0], /203\.0\.113\.10/);
  assert.equal(calls[0][1], BOARD_EVENTS_TRUSTED_IP_LIMIT);
  assert.equal(calls[0][2], BOARD_EVENTS_INTERVAL_MS);
  assert.match(
    calls[1][0],
    new RegExp(`^board-events:${BOARD_ID}:visitor:[A-Za-z0-9_-]{43}$`),
  );
  assert.equal(calls[1][1], BOARD_EVENTS_VISITOR_LIMIT);
  assert.equal(calls[1][2], BOARD_EVENTS_INTERVAL_MS);
});

test("an invalid trusted-proxy boundary cannot create an IP bucket", async () => {
  const calls = [];
  await assertBoardEventsRateLimits({
    boardId: BOARD_ID,
    headers: new Headers({ "x-forwarded-for": "not-an-ip" }),
    visitorPayload: VISITOR_PAYLOAD,
    env: { ...BASE_ENV, TRUSTED_PROXY_HOPS: "1" },
    assertLimit: async (...args) => {
      calls.push(args);
    },
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0][0], /:visitor:/);
});

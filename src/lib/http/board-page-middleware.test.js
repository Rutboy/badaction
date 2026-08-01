import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { VISITOR_COOKIE_NAME } from "../cookies/visitor-cookie.ts";
import {
  createSignedVisitorToken,
  verifySignedVisitorToken,
} from "../cookies/visitor-token-core.ts";
import { ApiError } from "../errors/api-error-base.ts";
import { createBoardPageMiddleware } from "./board-page-middleware.ts";

const BOARD_ID = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
const ENV = {
  NODE_ENV: "test",
  VISITOR_TOKEN_SECRET: "unit-test-visitor-token-secret-value",
  RATE_LIMIT_KEY_SECRET: "unit-test-rate-limit-key-secret-value",
  TRUSTED_PROXY_HOPS: "0",
};

test("first authorized board page request is limited and receives a signed cookie", async () => {
  const calls = [];
  const middleware = createBoardPageMiddleware({
    env: ENV,
    authorizeBoardAccess: async () => {},
    rateLimitBoardRead: async (input) => {
      calls.push(input);
    },
  });

  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`),
  );
  const cookieValue = response.cookies.get(VISITOR_COOKIE_NAME)?.value;

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].boardId, BOARD_ID);
  assert.ok(cookieValue);
  assert.equal(
    verifySignedVisitorToken(cookieValue, ENV.VISITOR_TOKEN_SECRET),
    calls[0].visitorPayload,
  );
});

test("valid visitor cookie is reused without another Set-Cookie", async () => {
  const firstMiddleware = createBoardPageMiddleware({
    env: ENV,
    authorizeBoardAccess: async () => {},
    rateLimitBoardRead: async () => {},
  });
  const firstResponse = await firstMiddleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`),
  );
  const cookieValue = firstResponse.cookies.get(VISITOR_COOKIE_NAME)?.value;
  assert.ok(cookieValue);

  const secondResponse = await firstMiddleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`, {
      headers: { cookie: `${VISITOR_COOKIE_NAME}=${cookieValue}` },
    }),
  );

  assert.equal(secondResponse.status, 200);
  assert.equal(secondResponse.cookies.get(VISITOR_COOKIE_NAME), undefined);
});

test("rate-limited first request returns 429, Retry-After, and the signed cookie", async () => {
  const middleware = createBoardPageMiddleware({
    env: ENV,
    authorizeBoardAccess: async () => {},
    rateLimitBoardRead: async () => {
      throw new ApiError(
        429,
        "RATE_LIMIT_EXCEEDED",
        "Слишком много запросов. Попробуйте позже.",
        { retryAfterSeconds: 17 },
      );
    },
  });

  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "17");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.ok(response.cookies.get(VISITOR_COOKIE_NAME)?.value);
  assert.deepEqual(await response.json(), {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Слишком много запросов. Попробуйте позже.",
      details: { retryAfterSeconds: 17 },
    },
  });
});

test("board authorization denial returns 404 without continuing to render", async () => {
  let rateLimitCalls = 0;
  const middleware = createBoardPageMiddleware({
    env: ENV,
    rateLimitBoardRead: async () => {
      rateLimitCalls += 1;
    },
    authorizeBoardAccess: async () => {
      throw new ApiError(404, "BOARD_NOT_FOUND", "Доска не найдена");
    },
  });

  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`),
  );

  assert.equal(response.status, 404);
  assert.equal(rateLimitCalls, 0);
  assert.equal(response.headers.get("x-middleware-next"), null);
  assert.ok(response.cookies.get(VISITOR_COOKIE_NAME)?.value);
  assert.deepEqual(await response.json(), {
    error: {
      code: "BOARD_NOT_FOUND",
      message: "Доска не найдена",
    },
  });
});

test("database authorization failure returns 503 without continuing to render", async () => {
  const middleware = createBoardPageMiddleware({
    env: ENV,
    rateLimitBoardRead: async () => {},
    authorizeBoardAccess: async () => {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "База данных временно недоступна.",
      );
    },
  });

  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`),
  );

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("x-middleware-next"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("invalid visitor cookie is rotated while authorization remains denied", async () => {
  let authorizedPayload;
  const middleware = createBoardPageMiddleware({
    env: ENV,
    rateLimitBoardRead: async () => {},
    authorizeBoardAccess: async (_boardId, visitorPayload) => {
      authorizedPayload = visitorPayload;
      throw new ApiError(404, "BOARD_NOT_FOUND", "Доска не найдена");
    },
  });

  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`, {
      headers: { cookie: `${VISITOR_COOKIE_NAME}=invalid-cookie` },
    }),
  );
  const rotatedCookie = response.cookies.get(VISITOR_COOKIE_NAME)?.value;

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("x-middleware-next"), null);
  assert.ok(rotatedCookie);
  assert.notEqual(rotatedCookie, "invalid-cookie");
  assert.equal(
    verifySignedVisitorToken(rotatedCookie, ENV.VISITOR_TOKEN_SECRET),
    authorizedPayload,
  );
});

test("invalid board path bypasses cookie issuance and the database limiter", async () => {
  let calls = 0;
  const middleware = createBoardPageMiddleware({
    env: ENV,
    authorizeBoardAccess: async () => {},
    rateLimitBoardRead: async () => {
      calls += 1;
    },
  });

  const response = await middleware(
    new NextRequest("https://retro.example/boards/not-a-uuid"),
  );

  assert.equal(response.status, 200);
  assert.equal(calls, 0);
  assert.equal(response.cookies.get(VISITOR_COOKIE_NAME), undefined);
});

test("percent-encoded UUID is decoded once and limited under its canonical ID", async () => {
  const authorizedBoardIds = [];
  const limitedBoardIds = [];
  const middleware = createBoardPageMiddleware({
    env: ENV,
    authorizeBoardAccess: async (boardId) => {
      authorizedBoardIds.push(boardId);
    },
    rateLimitBoardRead: async ({ boardId }) => {
      limitedBoardIds.push(boardId);
    },
  });

  const encodedBoardId = `%65${BOARD_ID.slice(1).toUpperCase()}`;
  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${encodedBoardId}`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(authorizedBoardIds, [BOARD_ID]);
  assert.deepEqual(limitedBoardIds, [BOARD_ID]);
  assert.ok(response.cookies.get(VISITOR_COOKIE_NAME)?.value);
});

test("aging cookie refresh preserves a revoked session tombstone before issuing the cookie", async () => {
  const payload = "R".repeat(43);
  const agingCookie = createSignedVisitorToken(
    ENV.VISITOR_TOKEN_SECRET,
    () => payload,
    Date.now() - 31 * 24 * 60 * 60 * 1000,
  );
  const events = [];
  const middleware = createBoardPageMiddleware({
    env: ENV,
    preserveCredentialRefresh: async (actualPayload) => {
      events.push(["preserve", actualPayload]);
    },
    authorizeBoardAccess: async () => {
      events.push(["authorize"]);
      throw new ApiError(404, "BOARD_NOT_FOUND", "Доска не найдена");
    },
    rateLimitBoardRead: async () => {},
  });

  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`, {
      headers: { cookie: `${VISITOR_COOKIE_NAME}=${agingCookie}` },
    }),
  );
  const refreshedCookie = response.cookies.get(VISITOR_COOKIE_NAME)?.value;

  assert.deepEqual(events, [["preserve", payload], ["authorize"]]);
  assert.equal(response.status, 404);
  assert.ok(refreshedCookie);
  assert.notEqual(refreshedCookie, agingCookie);
  assert.equal(
    verifySignedVisitorToken(refreshedCookie, ENV.VISITOR_TOKEN_SECRET),
    payload,
  );
});

test("aging cookie is not refreshed when tombstone preservation fails", async () => {
  const agingCookie = createSignedVisitorToken(
    ENV.VISITOR_TOKEN_SECRET,
    () => "S".repeat(43),
    Date.now() - 31 * 24 * 60 * 60 * 1000,
  );
  const middleware = createBoardPageMiddleware({
    env: ENV,
    preserveCredentialRefresh: async () => {
      throw new ApiError(
        503,
        "DATABASE_UNAVAILABLE",
        "База данных временно недоступна.",
      );
    },
    authorizeBoardAccess: async () => {
      throw new Error("authorization must not run");
    },
    rateLimitBoardRead: async () => {},
  });

  const response = await middleware(
    new NextRequest(`https://retro.example/boards/${BOARD_ID}`, {
      headers: { cookie: `${VISITOR_COOKIE_NAME}=${agingCookie}` },
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(response.cookies.get(VISITOR_COOKIE_NAME), undefined);
});

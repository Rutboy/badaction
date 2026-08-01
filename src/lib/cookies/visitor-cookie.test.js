import test from "node:test";
import assert from "node:assert/strict";
import {
  getVisitorCookieOptions,
  resolveVisitorCookie,
  VISITOR_COOKIE_NAME,
} from "./visitor-cookie.ts";
import { createSignedVisitorToken, verifySignedVisitorToken } from "./visitor-token-core.ts";

const ENV = {
  NODE_ENV: "test",
  VISITOR_TOKEN_SECRET: "unit-test-visitor-token-secret-value",
};

test("resolves a first request to a signed visitor cookie", () => {
  const resolved = resolveVisitorCookie(undefined, ENV);

  assert.equal(VISITOR_COOKIE_NAME, "visitor_token");
  assert.ok(resolved.cookieValueToSet);
  assert.equal(
    verifySignedVisitorToken(resolved.cookieValueToSet, ENV.VISITOR_TOKEN_SECRET),
    resolved.payload,
  );
});

test("reuses a valid signed visitor cookie without rotating it", () => {
  const first = resolveVisitorCookie(undefined, ENV);
  const second = resolveVisitorCookie(first.cookieValueToSet, ENV);

  assert.equal(second.payload, first.payload);
  assert.equal(second.cookieValueToSet, null);
  assert.equal(second.refreshesExistingCredential, false);
});

test("refreshes an aging signed cookie without changing its anonymous identity", () => {
  const issuedAt = Date.UTC(2026, 0, 1);
  const payload = "R".repeat(43);
  const token = createSignedVisitorToken(
    ENV.VISITOR_TOKEN_SECRET,
    () => payload,
    issuedAt,
  );
  const refreshedAt = issuedAt + 31 * 24 * 60 * 60 * 1000;
  const resolved = resolveVisitorCookie(token, ENV, refreshedAt);

  assert.equal(resolved.payload, payload);
  assert.ok(resolved.cookieValueToSet);
  assert.equal(resolved.refreshesExistingCredential, true);
  assert.notEqual(resolved.cookieValueToSet, token);
  assert.equal(
    verifySignedVisitorToken(resolved.cookieValueToSet, ENV.VISITOR_TOKEN_SECRET, refreshedAt),
    payload,
  );
});

test("cookie options keep the visitor token server-only", () => {
  assert.deepEqual(getVisitorCookieOptions({ NODE_ENV: "production" }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 34_560_000,
  });
});

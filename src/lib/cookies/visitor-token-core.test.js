import test from "node:test";
import assert from "node:assert/strict";
import {
  createSignedVisitorToken,
  deriveBoardVisitorId,
  verifySignedVisitorToken,
} from "./visitor-token-core.ts";

const SECRET = "a-test-secret-that-is-long-enough-for-hmac";
const PAYLOAD = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

test("creates and verifies signed visitor tokens", () => {
  const now = Date.UTC(2026, 6, 31);
  const token = createSignedVisitorToken(SECRET, () => PAYLOAD, now);

  assert.equal(verifySignedVisitorToken(token, SECRET, now), PAYLOAD);
  assert.equal(verifySignedVisitorToken(token, "different-secret", now), null);
  assert.equal(verifySignedVisitorToken(`${token}tampered`, SECRET, now), null);
});

test("rejects expired, replayed legacy, and implausibly future visitor tokens", () => {
  const now = Date.UTC(2026, 6, 31);
  const token = createSignedVisitorToken(SECRET, () => PAYLOAD, now);
  const lifetime = 400 * 24 * 60 * 60 * 1000;

  assert.equal(verifySignedVisitorToken(token, SECRET, now + lifetime - 1), PAYLOAD);
  assert.equal(verifySignedVisitorToken(token, SECRET, now + lifetime), null);
  assert.equal(verifySignedVisitorToken(token, SECRET, now - 5 * 60 * 1000 - 1), null);
  assert.equal(verifySignedVisitorToken(`v1.${PAYLOAD}.unsigned`, SECRET, now), null);
});

test("rejects malformed and unsigned visitor tokens", () => {
  assert.equal(verifySignedVisitorToken(PAYLOAD, SECRET), null);
  assert.equal(verifySignedVisitorToken("v1.short.signature", SECRET), null);
  assert.equal(verifySignedVisitorToken("v2.payload.signature", SECRET), null);
});

test("derives stable IDs scoped to a board", () => {
  const first = deriveBoardVisitorId(PAYLOAD, "board-a", SECRET);
  const boardUuid = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";

  assert.equal(first, deriveBoardVisitorId(PAYLOAD, "board-a", SECRET));
  assert.notEqual(first, deriveBoardVisitorId(PAYLOAD, "board-b", SECRET));
  assert.notEqual(first, deriveBoardVisitorId(`${PAYLOAD}B`, "board-a", SECRET));
  assert.equal(
    deriveBoardVisitorId(PAYLOAD, boardUuid, SECRET),
    deriveBoardVisitorId(PAYLOAD, boardUuid.toUpperCase(), SECRET),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../errors/api-error-base.ts";
import {
  BoardStreamLimit,
  MAX_BOARD_STREAMS_PER_VISITOR,
} from "./board-stream-limit.ts";

const BOARD_ID = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
const OTHER_BOARD_ID = "8a73a276-8103-4b68-9de7-dad5e45dceb5";
const VISITOR_IDENTITY = "visitor-one";

const assertStreamLimitError = (operation) => {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof ApiError, true);
    assert.equal(error.status, 429);
    assert.equal(error.code, "RATE_LIMIT_EXCEEDED");
    assert.equal(error.message, "Too many concurrent connections to this board.");
    assert.deepEqual(error.details, { retryAfterSeconds: 30 });
    return true;
  });
};

test("a board and visitor pair is capped at exactly three concurrent streams", () => {
  assert.equal(MAX_BOARD_STREAMS_PER_VISITOR, 3);
  const limit = new BoardStreamLimit();
  const leases = Array.from(
    { length: MAX_BOARD_STREAMS_PER_VISITOR },
    () => limit.acquire(BOARD_ID, VISITOR_IDENTITY),
  );

  assertStreamLimitError(() => limit.acquire(BOARD_ID, VISITOR_IDENTITY));

  for (const lease of leases) {
    lease.release();
  }
});

test("stream limits are independent across boards and visitors", () => {
  const limit = new BoardStreamLimit();
  const leases = Array.from(
    { length: MAX_BOARD_STREAMS_PER_VISITOR },
    () => limit.acquire(BOARD_ID, VISITOR_IDENTITY),
  );

  const otherBoardLease = limit.acquire(OTHER_BOARD_ID, VISITOR_IDENTITY);
  const otherVisitorLease = limit.acquire(BOARD_ID, "visitor-two");
  assertStreamLimitError(() => limit.acquire(BOARD_ID, VISITOR_IDENTITY));

  otherBoardLease.release();
  otherVisitorLease.release();
  for (const lease of leases) {
    lease.release();
  }
});

test("release is idempotent and frees exactly one stream slot", () => {
  const limit = new BoardStreamLimit();
  const leases = Array.from(
    { length: MAX_BOARD_STREAMS_PER_VISITOR },
    () => limit.acquire(BOARD_ID, VISITOR_IDENTITY),
  );

  leases[0].release();
  leases[0].release();
  const replacement = limit.acquire(BOARD_ID, VISITOR_IDENTITY);
  assertStreamLimitError(() => limit.acquire(BOARD_ID, VISITOR_IDENTITY));

  replacement.release();
  leases[1].release();
  leases[2].release();

  const freshLeases = Array.from(
    { length: MAX_BOARD_STREAMS_PER_VISITOR },
    () => limit.acquire(BOARD_ID, VISITOR_IDENTITY),
  );
  for (const lease of freshLeases) {
    lease.release();
  }
});

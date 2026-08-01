import test from "node:test";
import assert from "node:assert/strict";
import {
  compareRevisions,
  formatBoardInvalidationEvent,
  formatBoardReadyEvent,
  formatHeartbeat,
  formatMutationInvalidationEvent,
  parseLastEventId,
} from "./sse-wire.ts";

const BOARD_ID = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
const MAX_POSTGRES_BIGINT = "9223372036854775807";

test("Last-Event-ID parser accepts absence and canonical PostgreSQL bigint revisions", () => {
  assert.equal(parseLastEventId(null), null);
  assert.equal(parseLastEventId("0"), 0n);
  assert.equal(parseLastEventId("42"), 42n);
  assert.equal(parseLastEventId(MAX_POSTGRES_BIGINT), 9_223_372_036_854_775_807n);
});

test("Last-Event-ID parser rejects malformed, negative, and overflowing revisions", () => {
  for (const value of [
    "",
    "00",
    "01",
    "-1",
    "+1",
    " 1",
    "1 ",
    "1.0",
    "1e3",
    "9223372036854775808",
    "10000000000000000000",
  ]) {
    assert.throws(
      () => parseLastEventId(value),
      /Last-Event-ID must be a canonical non-negative revision/,
      value,
    );
  }
});

test("revision comparison is numeric rather than lexicographic", () => {
  assert.equal(compareRevisions("9", "10"), -1);
  assert.equal(compareRevisions("10", "9"), 1);
  assert.equal(compareRevisions(MAX_POSTGRES_BIGINT, MAX_POSTGRES_BIGINT), 0);
});

test("board.ready frame is exact and deliberately has no event id", () => {
  assert.equal(
    formatBoardReadyEvent(BOARD_ID, "42"),
    `event: board.ready\ndata: {"boardId":"${BOARD_ID}","revision":"42"}\n\n`,
  );
});

test("mutation invalidation frame contains the revision event id and exact payload", () => {
  const event = {
    boardId: BOARD_ID,
    revision: "43",
    type: "card.created",
  };
  const expected = [
    "id: 43",
    "event: board.invalidate",
    `data: {"boardId":"${BOARD_ID}","revision":"43","type":"card.created"}`,
    "",
    "",
  ].join("\n");

  assert.equal(formatBoardInvalidationEvent(event), expected);
  assert.equal(formatMutationInvalidationEvent(event), expected);
});

test("synthetic resync invalidation advances Last-Event-ID to the current revision", () => {
  assert.equal(
    formatBoardInvalidationEvent({
      boardId: BOARD_ID,
      revision: "44",
      type: "resync",
    }),
    [
      "id: 44",
      "event: board.invalidate",
      `data: {"boardId":"${BOARD_ID}","revision":"44","type":"resync"}`,
      "",
      "",
    ].join("\n"),
  );
});

test("heartbeat is an exact SSE comment frame", () => {
  assert.equal(formatHeartbeat(), ": heartbeat\n\n");
});

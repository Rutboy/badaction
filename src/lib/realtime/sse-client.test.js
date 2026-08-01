import test from "node:test";
import assert from "node:assert/strict";
import {
  getReconnectDelayMs,
  parseBoardSseEvent,
  SseEventParser,
  SseProtocolError,
} from "./sse-client.ts";

const BOARD_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_BOARD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const readyRaw = (revision = "42") => ({
  event: "board.ready",
  data: JSON.stringify({ boardId: BOARD_ID, revision }),
  id: null,
});

const invalidateRaw = ({
  revision = "43",
  type = "card.created",
  id = revision,
  boardId = BOARD_ID,
} = {}) => ({
  event: "board.invalidate",
  data: JSON.stringify({ boardId, revision, type }),
  id,
});

test("incremental parser handles chunk boundaries, CRLF, comments, multiple events, and multiline data", () => {
  const parser = new SseEventParser();
  const chunks = [
    ": heart",
    "beat\r",
    "\n\r",
    "\nevent: board.ready\r\ndata: {\"boardId\":\"",
    BOARD_ID,
    "\",\"revision\":\"42\"}\r\n\r",
    "\nid: 43\nevent: board.invalidate\ndata: {\"boardId\":\"",
    BOARD_ID,
    "\",\ndata: \"revision\":\"43\",\ndata: \"type\":\"card.created\"}\n\n",
  ];

  const events = chunks.flatMap((chunk) => parser.push(chunk));

  assert.deepEqual(events, [
    readyRaw(),
    {
      event: "board.invalidate",
      data: [
        `{\"boardId\":\"${BOARD_ID}\",`,
        "\"revision\":\"43\",",
        "\"type\":\"card.created\"}",
      ].join("\n"),
      id: "43",
    },
  ]);
  assert.deepEqual(parser.finish(), []);
});

test("parser finish discards an unterminated event and is idempotent", () => {
  const parser = new SseEventParser();
  assert.deepEqual(parser.push("event: board.ready\ndata: {}"), []);
  assert.deepEqual(parser.finish(), []);
  assert.deepEqual(parser.finish(), []);
  assert.throws(() => parser.push("data: {}\n\n"), /finished SSE parser/);
});

test("parser ignores comments and unknown fields", () => {
  const parser = new SseEventParser();
  assert.deepEqual(parser.push(": heartbeat\nretry: 1000\nunknown: value\n\n"), []);
});

test("board.ready validation returns a discriminated event", () => {
  assert.deepEqual(parseBoardSseEvent(readyRaw(), BOARD_ID), {
    event: "board.ready",
    boardId: BOARD_ID,
    revision: "42",
  });
});

test("board.invalidate validation accepts registry events and synthetic resync", () => {
  assert.deepEqual(parseBoardSseEvent(invalidateRaw(), BOARD_ID), {
    event: "board.invalidate",
    id: "43",
    boardId: BOARD_ID,
    revision: "43",
    type: "card.created",
  });
  assert.deepEqual(
    parseBoardSseEvent(invalidateRaw({ revision: "44", type: "resync" }), BOARD_ID),
    {
      event: "board.invalidate",
      id: "44",
      boardId: BOARD_ID,
      revision: "44",
      type: "resync",
    },
  );
});

test("validator requires the exact canonical board id", () => {
  assert.throws(
    () => parseBoardSseEvent(invalidateRaw({ boardId: OTHER_BOARD_ID }), BOARD_ID),
    SseProtocolError,
  );
  assert.throws(
    () => parseBoardSseEvent(readyRaw(), BOARD_ID.toUpperCase()),
    /canonical UUID v4/,
  );
});

test("validator accepts PostgreSQL bigint boundaries and rejects invalid revisions", () => {
  for (const revision of ["0", "9223372036854775807"]) {
    assert.equal(parseBoardSseEvent(readyRaw(revision), BOARD_ID).revision, revision);
  }

  for (const revision of [
    "",
    "01",
    "+1",
    "-1",
    " 1",
    "9223372036854775808",
    "10000000000000000000",
  ]) {
    assert.throws(
      () => parseBoardSseEvent(readyRaw(revision), BOARD_ID),
      /canonical PostgreSQL bigint/,
    );
  }

  assert.throws(
    () => parseBoardSseEvent({
      event: "board.ready",
      data: JSON.stringify({ boardId: BOARD_ID, revision: 42 }),
      id: null,
    }, BOARD_ID),
    /canonical PostgreSQL bigint/,
  );
});

test("validator requires strict event JSON shapes", () => {
  const invalidEvents = [
    { event: "board.ready", data: "not-json", id: null },
    { event: "board.ready", data: "[]", id: null },
    {
      event: "board.ready",
      data: JSON.stringify({ boardId: BOARD_ID, revision: "42", extra: true }),
      id: null,
    },
    {
      event: "board.invalidate",
      data: JSON.stringify({ boardId: BOARD_ID, revision: "43" }),
      id: "43",
    },
  ];

  for (const event of invalidEvents) {
    assert.throws(() => parseBoardSseEvent(event, BOARD_ID), SseProtocolError);
  }
});

test("validator requires invalidate id to equal revision and a registered type", () => {
  assert.throws(
    () => parseBoardSseEvent(invalidateRaw({ id: "42" }), BOARD_ID),
    /id must equal its revision/,
  );
  assert.throws(
    () => parseBoardSseEvent(invalidateRaw({ id: null }), BOARD_ID),
    /id must equal its revision/,
  );
  assert.throws(
    () => parseBoardSseEvent(invalidateRaw({ type: "card.unknown" }), BOARD_ID),
    /event registry/,
  );
  assert.throws(
    () => parseBoardSseEvent({ ...readyRaw(), id: "42" }, BOARD_ID),
    /must not include an event id/,
  );
  assert.throws(
    () => parseBoardSseEvent({ event: "message", data: "{}", id: null }, BOARD_ID),
    /Unsupported SSE event/,
  );
});

test("reconnect backoff is deterministic and capped at 30 seconds", () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, attempt) => getReconnectDelayMs(attempt)),
    [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000, 30_000],
  );
  assert.throws(() => getReconnectDelayMs(-1), RangeError);
  assert.throws(() => getReconnectDelayMs(1.5), RangeError);
});

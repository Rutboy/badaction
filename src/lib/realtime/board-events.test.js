import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_MUTATION_EVENT_TYPES,
  parseBoardMutationEvent,
  serializeBoardMutationEvent,
} from "./board-events.ts";

const BOARD_ID = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
const MAX_POSTGRES_BIGINT = "9223372036854775807";

const eventPayload = ({
  boardId = BOARD_ID,
  revision = "42",
  type = "card.created",
  ...extra
} = {}) => JSON.stringify({ boardId, revision, type, ...extra });

test("mutation event registry is exact, stable, and duplicate-free", () => {
  assert.deepEqual(BOARD_MUTATION_EVENT_TYPES, [
    "board.updated",
    "column.created",
    "column.updated",
    "column.moved",
    "column.deleted",
    "card.created",
    "card.updated",
    "card.moved",
    "card.deleted",
    "vote.updated",
    "votes.reset",
    "group.created",
    "group.updated",
    "group.moved",
    "group.deleted",
    "action.created",
    "action.updated",
    "action.moved",
    "action.deleted",
  ]);
  assert.equal(new Set(BOARD_MUTATION_EVENT_TYPES).size, BOARD_MUTATION_EVENT_TYPES.length);
});

test("mutation event payload round-trips every registered type without extra data", () => {
  for (const type of BOARD_MUTATION_EVENT_TYPES) {
    const event = { boardId: BOARD_ID, revision: "42", type };
    const serialized = serializeBoardMutationEvent(event);

    assert.equal(
      serialized,
      `{"boardId":"${BOARD_ID}","revision":"42","type":"${type}"}`,
    );
    assert.deepEqual(parseBoardMutationEvent(serialized), event);
  }
});

test("mutation event parser accepts the PostgreSQL bigint boundaries", () => {
  assert.deepEqual(parseBoardMutationEvent(eventPayload({ revision: "0" })), {
    boardId: BOARD_ID,
    revision: "0",
    type: "card.created",
  });
  assert.deepEqual(parseBoardMutationEvent(eventPayload({ revision: MAX_POSTGRES_BIGINT })), {
    boardId: BOARD_ID,
    revision: MAX_POSTGRES_BIGINT,
    type: "card.created",
  });
});

test("mutation event parser rejects malformed or non-strict object payloads", () => {
  const invalidPayloads = [
    "",
    "not-json",
    "null",
    "[]",
    JSON.stringify("event"),
    JSON.stringify({ boardId: BOARD_ID, revision: "42" }),
    eventPayload({ extra: "not-allowed" }),
    JSON.stringify({ boardId: BOARD_ID, revision: "42", type: "card.created", extra: null }),
    JSON.stringify({ boardId: BOARD_ID, revision: 42, type: "card.created" }),
    JSON.stringify({ boardId: BOARD_ID, revision: "42", type: null }),
  ];

  for (const payload of invalidPayloads) {
    assert.equal(parseBoardMutationEvent(payload), null, payload);
  }
});

test("mutation event parser rejects non-canonical board IDs and unknown types", () => {
  const invalidPayloads = [
    eventPayload({ boardId: BOARD_ID.toUpperCase() }),
    eventPayload({ boardId: "e3033b7f-58e4-32a5-b2fa-1a98069f3aa2" }),
    eventPayload({ boardId: "e3033b7f-58e4-42a5-72fa-1a98069f3aa2" }),
    eventPayload({ boardId: "not-a-uuid" }),
    eventPayload({ type: "resync" }),
    eventPayload({ type: "card.created.extra" }),
  ];

  for (const payload of invalidPayloads) {
    assert.equal(parseBoardMutationEvent(payload), null, payload);
  }
});

test("mutation event parser rejects non-canonical and overflowing revisions", () => {
  for (const revision of [
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
    assert.equal(parseBoardMutationEvent(eventPayload({ revision })), null, revision);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { sortBoardItemsByVotes } from "./board-sort.ts";

const card = (id, position, voteCount) => ({
  kind: "CARD",
  id,
  columnId: "column-id",
  text: id,
  author: null,
  position,
  voteCount,
  viewerHasVoted: false,
  canEdit: true,
  canDelete: true,
  canMove: true,
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
});

test("sorts cards by vote count without changing the stored item array", () => {
  const original = [card("first", 1024, 1), card("second", 2048, 4)];
  const sorted = sortBoardItemsByVotes(original);

  assert.deepEqual(
    sorted.map(({ id }) => id),
    ["second", "first"],
  );
  assert.deepEqual(
    original.map(({ id }) => id),
    ["first", "second"],
  );
});

test("uses the original board order to break equal vote counts", () => {
  const sorted = sortBoardItemsByVotes([
    card("third", 3072, 2),
    card("first", 1024, 2),
    card("second", 2048, 2),
  ]);

  assert.deepEqual(
    sorted.map(({ id }) => id),
    ["first", "second", "third"],
  );
});

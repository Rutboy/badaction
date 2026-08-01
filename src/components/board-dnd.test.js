import test from "node:test";
import assert from "node:assert/strict";
import {
  boardDndIds,
  buildActionItemPlacement,
  buildColumnPlacement,
  buildItemPlacement,
  moveBoardSnapshot,
  parseBoardDndId,
} from "./board-dnd.ts";

const card = (id, columnId) => ({
  kind: "CARD",
  id,
  columnId,
  text: id,
  author: null,
  position: 1024,
  voteCount: 0,
  viewerHasVoted: false,
  canEdit: true,
  canDelete: true,
  canMove: true,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const group = (id, columnId) => ({
  kind: "GROUP",
  id,
  columnId,
  position: 2048,
  title: null,
  primaryCardId: `${id}-primary`,
  voteCount: 0,
  viewerHasVoted: false,
  canMove: true,
  canUngroup: true,
  cards: [card(`${id}-primary`, columnId), card(`${id}-secondary`, columnId)],
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const action = (id) => ({
  id,
  text: id,
  assignee: null,
  completed: false,
  position: 1024,
  sourceCardId: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const board = () => ({
  id: "board",
  title: "Ретро",
  revision: "7",
  createdAt: "2026-08-01T00:00:00.000Z",
  expiresAt: "2026-10-30T00:00:00.000Z",
  settings: {
    cardsEnabled: true,
    votingEnabled: true,
    readOnly: false,
  },
  viewer: { role: "OWNER", displayName: "Владелец" },
  capabilities: {
    canManageSettings: true,
    canManageAccess: true,
    canManageColumns: true,
    canManageGroups: true,
    canManageActionItems: true,
    canResetVotes: true,
    canDeleteBoard: true,
    canLeaveBoard: false,
    canCreateCards: true,
    canVote: true,
  },
  columns: [
    {
      id: "first",
      title: "Первая",
      position: 1024,
      voteLimit: 3,
      items: [card("a", "first"), card("b", "first"), group("g", "first")],
      totalCount: 3,
      nextCursor: null,
    },
    {
      id: "second",
      title: "Вторая",
      position: 2048,
      voteLimit: 3,
      items: [card("c", "second")],
      totalCount: 1,
      nextCursor: null,
    },
  ],
  remainingVotesByColumn: { first: 3, second: 3 },
  actionItems: [action("one"), action("two"), action("three")],
});

test("placement helpers use final head, middle, tail, and singleton neighbors", () => {
  const items = [
    { kind: "CARD", id: "a", clientOnly: "not in the wire payload" },
    { kind: "GROUP", id: "g", clientOnly: "not in the wire payload" },
    { kind: "CARD", id: "b", clientOnly: "not in the wire payload" },
  ];
  assert.deepEqual(buildItemPlacement(items, items[0]), {
    before: null,
    after: { kind: "GROUP", id: "g" },
  });
  assert.deepEqual(buildItemPlacement(items, items[1]), {
    before: { kind: "CARD", id: "a" },
    after: { kind: "CARD", id: "b" },
  });
  assert.deepEqual(buildItemPlacement(items, items[2]), {
    before: { kind: "GROUP", id: "g" },
    after: null,
  });
  assert.deepEqual(buildItemPlacement([{ kind: "CARD", id: "only" }], {
    kind: "CARD",
    id: "only",
  }), { before: null, after: null });

  assert.deepEqual(buildColumnPlacement(["a", "b", "c"], "b"), {
    beforeColumnId: "a",
    afterColumnId: "c",
  });
  assert.deepEqual(buildColumnPlacement(["only"], "only"), {
    beforeColumnId: null,
    afterColumnId: null,
  });
  assert.deepEqual(buildActionItemPlacement(["a", "b", "c"], "c"), {
    beforeActionItemId: "b",
    afterActionItemId: null,
  });
});

test("DnD IDs round-trip every namespace and reject malformed values", () => {
  const values = [
    boardDndIds.column("column-id"),
    boardDndIds.item({ kind: "CARD", id: "card-id" }),
    boardDndIds.item({ kind: "GROUP", id: "group-id" }),
    boardDndIds.columnDrop("column-id"),
    boardDndIds.action("action-id"),
  ];
  assert.deepEqual(values.map(parseBoardDndId), [
    { namespace: "COLUMN", columnId: "column-id" },
    { namespace: "ITEM", item: { kind: "CARD", id: "card-id" } },
    { namespace: "ITEM", item: { kind: "GROUP", id: "group-id" } },
    { namespace: "COLUMN_DROP", columnId: "column-id" },
    { namespace: "ACTION", actionItemId: "action-id" },
  ]);
  assert.equal(parseBoardDndId(123), null);
  assert.equal(parseBoardDndId("ITEM:OTHER:id"), null);
  assert.equal(parseBoardDndId("COLUMN:"), null);
  assert.equal(parseBoardDndId("ACTION:id:extra"), null);
});

test("snapshot helper reorders columns and items within one column", () => {
  const initial = board();
  const columnsMoved = moveBoardSnapshot(initial, {
    namespace: "COLUMN",
    columnId: "first",
    targetIndex: 1,
  });
  assert.deepEqual(columnsMoved.columns.map((column) => column.id), ["second", "first"]);

  const itemMoved = moveBoardSnapshot(initial, {
    namespace: "ITEM",
    item: { kind: "CARD", id: "a" },
    targetColumnId: "first",
    targetIndex: 2,
  });
  assert.deepEqual(itemMoved.columns[0].items.map((item) => item.id), ["b", "g", "a"]);
  assert.equal(itemMoved.columns[0].totalCount, 3);
});

test("snapshot helper moves a whole group across columns and adjusts counts", () => {
  const initial = board();
  const before = structuredClone(initial);
  const moved = moveBoardSnapshot(initial, {
    namespace: "ITEM",
    item: { kind: "GROUP", id: "g" },
    targetColumnId: "second",
    targetIndex: 0,
  });

  assert.deepEqual(moved.columns[0].items.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(moved.columns[1].items.map((item) => item.id), ["g", "c"]);
  assert.equal(moved.columns[0].totalCount, 2);
  assert.equal(moved.columns[1].totalCount, 2);
  const movedGroup = moved.columns[1].items[0];
  assert.equal(movedGroup.columnId, "second");
  assert.equal(movedGroup.kind, "GROUP");
  assert.deepEqual(movedGroup.cards.map((item) => item.columnId), ["second", "second"]);
  assert.deepEqual(initial, before);
  assert.notEqual(moved.columns[0], initial.columns[0]);
  assert.notEqual(moved.columns[1], initial.columns[1]);
});

test("snapshot helper reorders actions without mutating the input", () => {
  const initial = board();
  const before = structuredClone(initial);
  const moved = moveBoardSnapshot(initial, {
    namespace: "ACTION",
    actionItemId: "one",
    targetIndex: 2,
  });

  assert.deepEqual(moved.actionItems.map((item) => item.id), ["two", "three", "one"]);
  assert.deepEqual(initial, before);
  assert.notEqual(moved, initial);
  assert.notEqual(moved.actionItems, initial.actionItems);
});

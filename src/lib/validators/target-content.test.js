import test from "node:test";
import assert from "node:assert/strict";
import {
  actionItemPlacementSchema,
  columnPlacementSchema,
  createTargetActionItemSchema,
  createTargetBoardSchema,
  createTargetCardSchema,
  createTargetColumnSchema,
  createTargetGroupSchema,
  deleteTargetColumnSchema,
  itemPlacementSchema,
  moveTargetCardSchema,
  patchTargetActionItemSchema,
  patchTargetBoardSchema,
  patchTargetCardSchema,
  patchTargetColumnSchema,
  patchTargetGroupSchema,
  resetTargetVotesSchema,
  revisionSchema,
  targetBoardPageQuerySchema,
  targetCardPageQuerySchema,
  targetUuidV4Schema,
  targetVoteMutationBodySchema,
} from "./target-content.ts";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ID_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";

test("canonicalizes UUID v4 and accepts only canonical decimal bigint revisions", () => {
  assert.equal(
    targetUuidV4Schema.parse("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAA1"),
    ID_A,
  );
  assert.equal(targetUuidV4Schema.safeParse("aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaa1").success, false);

  for (const revision of ["0", "1", "42", "9223372036854775807"]) {
    assert.equal(revisionSchema.parse(revision), revision);
  }
  for (const revision of ["", "00", "01", "-1", "1.0", "abc", "9223372036854775808"]) {
    assert.equal(revisionSchema.safeParse(revision).success, false, revision);
  }
});

test("board schemas trim values, reject empty PATCH and unknown fields", () => {
  assert.deepEqual(createTargetBoardSchema.parse({ title: "  Ретро команды  " }), {
    title: "Ретро команды",
  });
  assert.deepEqual(
    patchTargetBoardSchema.parse({ title: " Новое имя ", votingEnabled: false }),
    { title: "Новое имя", votingEnabled: false },
  );
  assert.equal(patchTargetBoardSchema.safeParse({}).success, false);
  assert.equal(
    createTargetBoardSchema.safeParse({ title: "Ретро", internalToken: "secret" }).success,
    false,
  );
  assert.equal(patchTargetBoardSchema.safeParse({ title: null }).success, false);
});

test("target page queries enforce dynamic column IDs, opaque cursors, and page limits", () => {
  assert.deepEqual(targetBoardPageQuerySchema.parse({}), { limit: 50 });
  assert.deepEqual(
    targetCardPageQuerySchema.parse({
      columnId: ID_A.toUpperCase(),
      cursor: "djE6Q0FSRDoxMDI0",
      limit: "100",
    }),
    { columnId: ID_A, cursor: "djE6Q0FSRDoxMDI0", limit: 100 },
  );
  assert.equal(targetCardPageQuerySchema.safeParse({ columnId: ID_A, limit: "101" }).success, false);
  assert.equal(
    targetCardPageQuerySchema.safeParse({ columnId: ID_A, cursor: "not base64!" }).success,
    false,
  );
});

test("placement schemas are strict and reject a duplicated neighbor", () => {
  assert.deepEqual(itemPlacementSchema.parse({ before: null, after: null }), {
    before: null,
    after: null,
  });
  assert.equal(
    itemPlacementSchema.safeParse({
      before: { kind: "CARD", id: ID_A },
      after: { kind: "CARD", id: ID_A },
    }).success,
    false,
  );
  assert.equal(
    columnPlacementSchema.safeParse({ beforeColumnId: ID_A, afterColumnId: ID_A }).success,
    false,
  );
  assert.equal(
    actionItemPlacementSchema.safeParse({
      beforeActionItemId: null,
      afterActionItemId: null,
      position: 1024,
    }).success,
    false,
  );
});

test("column schemas enforce limits, expected revisions, and strict delete strategies", () => {
  assert.deepEqual(
    createTargetColumnSchema.parse({
      title: " Идеи ",
      voteLimit: 20,
      placement: { beforeColumnId: ID_A, afterColumnId: null },
      expectedRevision: "3",
    }),
    {
      title: "Идеи",
      voteLimit: 20,
      placement: { beforeColumnId: ID_A, afterColumnId: null },
      expectedRevision: "3",
    },
  );
  assert.equal(patchTargetColumnSchema.safeParse({ voteLimit: 2 }).success, false);
  assert.equal(
    patchTargetColumnSchema.safeParse({ voteLimit: 21, expectedRevision: "2" }).success,
    false,
  );
  assert.equal(patchTargetColumnSchema.safeParse({ expectedRevision: "2" }).success, false);
  assert.equal(
    deleteTargetColumnSchema.safeParse({
      strategy: "deleteCards",
      confirmDeleteCards: false,
      expectedRevision: "2",
    }).success,
    false,
  );
  assert.equal(
    deleteTargetColumnSchema.safeParse({
      strategy: "moveCards",
      targetColumnId: ID_B,
      expectedRevision: "2",
    }).success,
    true,
  );
});

test("card schemas normalize nullable author and reject client positions", () => {
  assert.deepEqual(
    createTargetCardSchema.parse({ columnId: ID_A, text: "  Всё хорошо 🚀  " }),
    { columnId: ID_A, text: "Всё хорошо 🚀", author: null },
  );
  assert.deepEqual(patchTargetCardSchema.parse({ author: null }), { author: null });
  assert.equal(patchTargetCardSchema.safeParse({}).success, false);
  assert.equal(patchTargetCardSchema.safeParse({ text: null }).success, false);
  assert.deepEqual(
    moveTargetCardSchema.parse({
      targetColumnId: ID_B,
      placement: { before: null, after: null },
      expectedRevision: "4",
    }).voteSortedColumnIds,
    [],
  );
  assert.equal(
    moveTargetCardSchema.safeParse({
      targetColumnId: ID_B,
      placement: { before: null, after: null },
      voteSortedColumnIds: [ID_A, ID_B],
      expectedRevision: "4",
    }).success,
    true,
  );
  assert.equal(
    moveTargetCardSchema.safeParse({
      targetColumnId: ID_B,
      placement: { before: null, after: null },
      voteSortedColumnIds: [ID_A, ID_A],
      expectedRevision: "4",
    }).success,
    false,
  );
  assert.equal(
    moveTargetCardSchema.safeParse({
      targetColumnId: ID_B,
      placement: { before: null, after: null },
      voteSortedColumnIds: [ID_A, ID_B, ID_C],
      expectedRevision: "4",
    }).success,
    false,
  );
  assert.equal(
    moveTargetCardSchema.safeParse({
      targetColumnId: ID_B,
      placement: { before: null, after: null },
      expectedRevision: "4",
      position: 1024,
    }).success,
    false,
  );
});

test("group schemas require unique originals and a primary from the group", () => {
  assert.deepEqual(
    createTargetGroupSchema.parse({
      columnId: ID_A,
      cardIds: [ID_A, ID_B],
      primaryCardId: ID_A,
      expectedRevision: "5",
    }),
    {
      columnId: ID_A,
      cardIds: [ID_A, ID_B],
      primaryCardId: ID_A,
      title: null,
      expectedRevision: "5",
    },
  );
  assert.equal(
    createTargetGroupSchema.safeParse({
      columnId: ID_A,
      cardIds: [ID_A, ID_A],
      primaryCardId: ID_A,
      expectedRevision: "5",
    }).success,
    false,
  );
  assert.equal(
    createTargetGroupSchema.safeParse({
      columnId: ID_A,
      cardIds: [ID_A, ID_B],
      primaryCardId: ID_C,
      expectedRevision: "5",
    }).success,
    false,
  );
  assert.equal(patchTargetGroupSchema.safeParse({ primaryCardId: ID_A }).success, false);
  assert.deepEqual(patchTargetGroupSchema.parse({ title: null }), { title: null });
});

test("vote and action schemas enforce confirmations and strict discriminated unions", () => {
  assert.equal(targetVoteMutationBodySchema.safeParse(undefined).success, true);
  assert.equal(targetVoteMutationBodySchema.safeParse({}).success, false);
  assert.equal(
    resetTargetVotesSchema.safeParse({ confirmation: "reset", expectedRevision: "5" }).success,
    false,
  );

  assert.deepEqual(
    createTargetActionItemSchema.parse({ source: "manual", text: "  Обновить DoD  " }),
    { source: "manual", text: "Обновить DoD", assignee: null },
  );
  assert.deepEqual(
    createTargetActionItemSchema.parse({ source: "card", sourceCardId: ID_A }),
    { source: "card", sourceCardId: ID_A, assignee: null },
  );
  assert.deepEqual(
    createTargetActionItemSchema.parse({ source: "group", sourceGroupId: ID_B }),
    { source: "group", sourceGroupId: ID_B, assignee: null },
  );
  assert.equal(
    createTargetActionItemSchema.safeParse({
      source: "card",
      sourceCardId: ID_A,
      text: "Нельзя переопределять скопированный текст",
    }).success,
    false,
  );
  assert.equal(patchTargetActionItemSchema.safeParse({}).success, false);
  assert.equal(patchTargetActionItemSchema.safeParse({ completed: null }).success, false);
});

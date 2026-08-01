import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CARD_PAGE_SIZE,
  MAX_CARD_PAGE_SIZE,
  boardPageQuerySchema,
  cardPageQuerySchema,
} from "./pagination.ts";

test("uses a bounded default board page size", () => {
  assert.deepEqual(boardPageQuerySchema.parse({}), { limit: DEFAULT_CARD_PAGE_SIZE });
  assert.deepEqual(boardPageQuerySchema.parse({ limit: String(MAX_CARD_PAGE_SIZE) }), {
    limit: MAX_CARD_PAGE_SIZE,
  });
  assert.equal(boardPageQuerySchema.safeParse({ limit: "0" }).success, false);
  assert.equal(boardPageQuerySchema.safeParse({ limit: "101" }).success, false);
  assert.equal(boardPageQuerySchema.safeParse({ limit: "1.5" }).success, false);
});

test("validates a column cursor page", () => {
  const cursor = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
  assert.deepEqual(
    cardPageQuerySchema.parse({ column: "WENT_WELL", cursor, limit: "25" }),
    { column: "WENT_WELL", cursor, limit: 25 },
  );
  assert.equal(cardPageQuerySchema.safeParse({ column: "UNKNOWN" }).success, false);
  assert.equal(cardPageQuerySchema.safeParse({ column: "ACTIONS", cursor: "invalid" }).success, false);
});


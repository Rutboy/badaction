import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "./api-error-base.ts";
import { contentErrors, ContentApiError } from "./content-errors.ts";

test("content error factories return typed ApiError instances with registry statuses", () => {
  const cases = [
    [contentErrors.invalidCursor(), 400, "INVALID_CURSOR"],
    [contentErrors.boardOwnerRequired(), 403, "BOARD_OWNER_REQUIRED"],
    [contentErrors.cardOwnerRequired(), 403, "CARD_OWNER_REQUIRED"],
    [contentErrors.boardNotFound(), 404, "BOARD_NOT_FOUND"],
    [contentErrors.columnNotFound(), 404, "COLUMN_NOT_FOUND"],
    [contentErrors.cardNotFound(), 404, "CARD_NOT_FOUND"],
    [contentErrors.groupNotFound(), 404, "GROUP_NOT_FOUND"],
    [contentErrors.actionItemNotFound(), 404, "ACTION_ITEM_NOT_FOUND"],
    [contentErrors.boardReadOnly(), 409, "BOARD_READ_ONLY"],
    [contentErrors.cardsDisabled(), 409, "CARDS_DISABLED"],
    [contentErrors.votingDisabled(), 409, "VOTING_DISABLED"],
    [contentErrors.cardGrouped(), 409, "CARD_GROUPED"],
    [contentErrors.columnNotEmpty(), 409, "COLUMN_NOT_EMPTY"],
    [contentErrors.lastColumnDeleteForbidden(), 409, "LAST_COLUMN_DELETE_FORBIDDEN"],
  ];

  for (const [error, status, code] of cases) {
    assert.equal(error instanceof ApiError, true);
    assert.equal(error instanceof ContentApiError, true);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    assert.equal(error.details, undefined);
    assert.match(error.message, /[A-Za-z]/);
    assert.doesNotMatch(error.message, /[А-Яа-яЁё]/);
  }
});

test("content errors expose only the safe details allowed by the registry", () => {
  assert.deepEqual(contentErrors.staleBoardRevision("43").details, {
    currentRevision: "43",
  });
  assert.deepEqual(contentErrors.voteLimitConflict("column-id", 2).details, {
    columnId: "column-id",
    requestedLimit: 2,
  });
  assert.deepEqual(contentErrors.voteMoveConflict("target-id").details, {
    targetColumnId: "target-id",
  });
  assert.deepEqual(contentErrors.boardCardLimitReached(500).details, { limit: 500 });
  assert.deepEqual(contentErrors.boardColumnLimitReached().details, { limit: 10 });
  assert.deepEqual(contentErrors.boardActionItemLimitReached().details, { limit: 200 });
  assert.deepEqual(contentErrors.columnVoteLimitReached("column-id", 3).details, {
    columnId: "column-id",
    limit: 3,
  });

  const exportError = contentErrors.boardExportLimitExceeded({
    cardLimit: 500,
    voteLimit: 10_000,
    internalCause: "database secret",
  });
  assert.deepEqual(exportError.details, { cardLimit: 500, voteLimit: 10_000 });
  assert.equal("internalCause" in exportError.details, false);
});

test("stale revision factory uses the safe English fallback message", () => {
  const error = contentErrors.staleBoardRevision("43");

  assert.equal(error.status, 409);
  assert.equal(error.code, "STALE_BOARD_REVISION");
  assert.equal(
    error.message,
    "The board changed. Refresh it and try again.",
  );
});

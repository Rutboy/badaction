import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBatchSize,
  parseCleanupArguments,
} from "../../../scripts/cleanup-expired.mjs";

test("cleanup batch size uses a bounded default and accepts inclusive limits", () => {
  assert.equal(parseBatchSize(undefined), 1000);
  assert.equal(parseBatchSize("1"), 1);
  assert.equal(parseBatchSize("10000"), 10000);
  assert.equal(parseCleanupArguments([]), 1000);
  assert.equal(parseCleanupArguments(["2500"]), 2500);
});

test("cleanup argument parsing rejects unsafe values and extra arguments", () => {
  for (const value of ["", "0", "10001", "1.5", "-1", "1e3", " 10", "10 "]) {
    assert.throws(() => parseBatchSize(value), /between 1 and 10000/);
  }

  assert.throws(
    () => parseCleanupArguments(["100", "unexpected"]),
    /at most one batch-size argument/,
  );
});

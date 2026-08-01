import test from "node:test";
import assert from "node:assert/strict";
import { OperationTimeoutError, withTimeout } from "./timeout.ts";

test("returns an operation result before the deadline", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 50), "ok");
});

test("rejects an operation after the deadline", async () => {
  await assert.rejects(
    withTimeout(new Promise(() => {}), 5),
    OperationTimeoutError,
  );
});

test("validates timeout duration", async () => {
  await assert.rejects(withTimeout(Promise.resolve("ok"), 0), RangeError);
});

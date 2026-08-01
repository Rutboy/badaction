import assert from "node:assert/strict";
import test from "node:test";
import { shouldStartApplicationLifecycle } from "./lib/runtime/instrumentation-gate.ts";

test("application lifecycle only starts in a runtime Node server", () => {
  assert.equal(shouldStartApplicationLifecycle("nodejs"), true);
  assert.equal(shouldStartApplicationLifecycle("edge"), false);
  assert.equal(shouldStartApplicationLifecycle(undefined), false);
  assert.equal(
    shouldStartApplicationLifecycle("nodejs", "phase-production-build"),
    false,
  );
});

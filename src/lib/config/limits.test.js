import test from "node:test";
import assert from "node:assert/strict";
import { parseIntegerSetting } from "./limits.ts";

const setting = {
  name: "TEST_LIMIT",
  defaultValue: 90,
  min: 1,
  max: 3650,
};

test("integer setting uses its default only when the variable is absent", () => {
  assert.equal(parseIntegerSetting(undefined, setting), 90);
});

test("integer setting accepts inclusive bounds", () => {
  assert.equal(parseIntegerSetting("1", setting), 1);
  assert.equal(parseIntegerSetting("3650", setting), 3650);
});

test("integer setting rejects empty, fractional, unsafe, and out-of-range values", () => {
  for (const value of ["", "1.5", "text", "0", "-1", "3651", "9007199254740992"]) {
    assert.throws(
      () => parseIntegerSetting(value, setting),
      /TEST_LIMIT must be an integer between 1 and 3650/,
    );
  }
});

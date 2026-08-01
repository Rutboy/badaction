import test from "node:test";
import assert from "node:assert/strict";
import { uuidParamSchema } from "./common.ts";

test("canonicalizes UUID parameters to lowercase", () => {
  const lowercase = "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2";
  const uppercase = lowercase.toUpperCase();

  assert.equal(uuidParamSchema.parse(lowercase), lowercase);
  assert.equal(uuidParamSchema.parse(uppercase), lowercase);
});

import test from "node:test";
import assert from "node:assert/strict";
import { normalizePrismaError, isDatabaseUnavailableError } from "./prisma.ts";
import { ApiError } from "./api-error-base.ts";

test("detects Prisma database initialization error", () => {
  const error = {
    name: "PrismaClientInitializationError",
    message: "Invalid `prisma.board.findUnique()` invocation:\n\nCan't reach database server at `localhost:5432`",
  };

  assert.equal(isDatabaseUnavailableError(error), true);
});

test("maps unavailable database error to ApiError 503", () => {
  const error = {
    name: "PrismaClientInitializationError",
    message: "Can't reach database server at `localhost:5432`",
  };

  const normalized = normalizePrismaError(error);

  assert.ok(normalized instanceof ApiError);
  assert.equal(normalized.status, 503);
  assert.equal(normalized.code, "DATABASE_UNAVAILABLE");
  assert.equal(normalized.message, "The database is unavailable. Try again later.");
});

test("leaves unrelated errors unchanged", () => {
  const error = new Error("something else");

  const normalized = normalizePrismaError(error);

  assert.equal(normalized, error);
});

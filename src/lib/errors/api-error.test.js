import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, toErrorResponse } from "./api-error.ts";

test("adds Retry-After to rate-limit responses", async () => {
  const response = toErrorResponse(
    new ApiError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many requests. Try again later.",
      { retryAfterSeconds: 12.1 },
    ),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "13");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Too many requests. Try again later.",
      details: { retryAfterSeconds: 12.1 },
    },
  });
});

test("does not add Retry-After to unrelated responses", () => {
  const response = toErrorResponse(
    new ApiError(400, "VALIDATION_ERROR", "Invalid request.", { retryAfterSeconds: 10 }),
  );

  assert.equal(response.headers.get("retry-after"), null);
});

test("masks unknown errors with a safe English fallback", async () => {
  const response = toErrorResponse(new Error("private database details"));

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error.",
    },
  });
});

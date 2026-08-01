import test from "node:test";
import assert from "node:assert/strict";
import { ApiError, toErrorResponse } from "./api-error.ts";

test("adds Retry-After to rate-limit responses", async () => {
  const response = toErrorResponse(
    new ApiError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Слишком много запросов",
      { retryAfterSeconds: 12.1 },
    ),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "13");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: {
      code: "RATE_LIMIT_EXCEEDED",
      message: "Слишком много запросов",
      details: { retryAfterSeconds: 12.1 },
    },
  });
});

test("does not add Retry-After to unrelated responses", () => {
  const response = toErrorResponse(
    new ApiError(400, "VALIDATION_ERROR", "Некорректный запрос", { retryAfterSeconds: 10 }),
  );

  assert.equal(response.headers.get("retry-after"), null);
});

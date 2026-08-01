import test from "node:test";
import assert from "node:assert/strict";
import { getServerSecret, hmacSha256, safeEqual } from "./hmac.ts";

test("requires a strong non-placeholder secret in production", () => {
  for (const value of [
    undefined,
    "too-short",
    "dev-only-visitor-token-secret-change-me",
    "replace-me-with-a-random-secret-value",
  ]) {
    assert.throws(
      () =>
        getServerSecret({
          env: { NODE_ENV: "production", SECRET: value },
          name: "SECRET",
          developmentFallback: "development-only-fallback",
        }),
      /SECRET/,
    );
  }

  const strongSecret = "3x6rEF9NVVHMxQPttB4yJcR2dMKJq7zqY5unh8wKauU";
  assert.equal(
    getServerSecret({
      env: { NODE_ENV: "production", SECRET: strongSecret },
      name: "SECRET",
      developmentFallback: "development-only-fallback",
    }),
    strongSecret,
  );
});

test("HMAC output is stable and compared without string equality", () => {
  const signature = hmacSha256("secret", "value");

  assert.equal(signature, hmacSha256("secret", "value"));
  assert.equal(safeEqual(signature, signature), true);
  assert.equal(safeEqual(signature, `${signature}x`), false);
});

test("requires independent application secrets in production", () => {
  const sharedSecret = "3x6rEF9NVVHMxQPttB4yJcR2dMKJq7zqY5unh8wKauU";
  assert.throws(
    () =>
      getServerSecret({
        env: {
          NODE_ENV: "production",
          VISITOR_TOKEN_SECRET: sharedSecret,
          BOARD_ACCESS_SECRET: sharedSecret,
          RATE_LIMIT_KEY_SECRET: "qW8gWkYzpSCpqQ8mvnWmMRQwFc7Tydr7xsXYPZ37qck",
        },
        name: "VISITOR_TOKEN_SECRET",
        developmentFallback: "development-only-fallback",
      }),
    /BOARD_ACCESS_SECRET/,
  );
});

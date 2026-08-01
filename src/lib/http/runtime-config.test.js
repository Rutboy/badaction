import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeConfiguration } from "./runtime-config.ts";

const VALID_PRODUCTION_ENV = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://db.example/retro",
  APP_ORIGIN: "https://retro.example",
  BOARD_ACCESS_SECRET: "Wm8qT4Kz7Nc2Fv9Yp5Lr3Xh6Ds1Ge0UaBiJoCkEdQwM",
  VISITOR_TOKEN_SECRET: "3x6rEF9NVVHMxQPttB4yJcR2dMKJq7zqY5unh8wKauU",
  RATE_LIMIT_KEY_SECRET: "Pj4ysb8N6QvU9Xc3Fm2Ta7Rd5Lk1We0ZoHgBnMvCsEi",
  TRUSTED_PROXY_HOPS: "1",
};

test("accepts complete production configuration", () => {
  assert.doesNotThrow(() =>
    validateRuntimeConfiguration(
      "http://internal:3000/api/health",
      VALID_PRODUCTION_ENV,
    ),
  );
});

test("allows explicit zero trusted proxy hops as degraded direct-host mode", () => {
  assert.doesNotThrow(() =>
    validateRuntimeConfiguration("http://internal:3000/api/health", {
      ...VALID_PRODUCTION_ENV,
      TRUSTED_PROXY_HOPS: "0",
    }),
  );
});

test("rejects missing database and origin configuration", () => {
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        DATABASE_URL: " ",
      }),
    /DATABASE_URL/,
  );
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        APP_ORIGIN: undefined,
      }),
    /APP_ORIGIN/,
  );
});

test("rejects a missing or weak board access secret in production", () => {
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        BOARD_ACCESS_SECRET: undefined,
      }),
    /BOARD_ACCESS_SECRET/,
  );
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        BOARD_ACCESS_SECRET: "development-only-board-access-secret",
      }),
    /BOARD_ACCESS_SECRET/,
  );
});

test("rejects invalid board retention and card limit configuration", () => {
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        BOARD_RETENTION_DAYS: "366",
      }),
    /BOARD_RETENTION_DAYS/,
  );
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        BOARD_RETENTION_DAYS: "0",
      }),
    /BOARD_RETENTION_DAYS/,
  );
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        BOARD_CARD_LIMIT: "not-a-number",
      }),
    /BOARD_CARD_LIMIT/,
  );
});

test("rejects invalid built-in retention cleanup configuration", () => {
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        RETENTION_CLEANUP_ENABLED: "sometimes",
      }),
    /RETENTION_CLEANUP_ENABLED/,
  );
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        RETENTION_CLEANUP_INTERVAL_MINUTES: "1441",
      }),
    /RETENTION_CLEANUP_INTERVAL_MINUTES/,
  );
  assert.throws(
    () =>
      validateRuntimeConfiguration("http://internal:3000/api/health", {
        ...VALID_PRODUCTION_ENV,
        RETENTION_CLEANUP_BATCH_SIZE: "0",
      }),
    /RETENTION_CLEANUP_BATCH_SIZE/,
  );
});

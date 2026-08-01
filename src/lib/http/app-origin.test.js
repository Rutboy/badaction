import test from "node:test";
import assert from "node:assert/strict";
import { getCanonicalAppOrigin } from "./app-origin.ts";

test("requires a canonical APP_ORIGIN in production", () => {
  assert.throws(
    () => getCanonicalAppOrigin("https://internal.example/request", { NODE_ENV: "production" }),
    /APP_ORIGIN/,
  );
  assert.equal(
    getCanonicalAppOrigin("http://internal:3000/request", {
      NODE_ENV: "production",
      APP_ORIGIN: "https://retro.example",
    }),
    "https://retro.example",
  );
});

test("allows HTTP only for localhost smoke tests", () => {
  assert.equal(
    getCanonicalAppOrigin("http://internal/request", {
      NODE_ENV: "production",
      APP_ORIGIN: "http://localhost:3000",
    }),
    "http://localhost:3000",
  );
  assert.throws(
    () =>
      getCanonicalAppOrigin("http://internal/request", {
        NODE_ENV: "production",
        APP_ORIGIN: "http://retro.example",
      }),
    /HTTPS/,
  );
});

test("rejects APP_ORIGIN paths and falls back to request origin outside production", () => {
  assert.throws(
    () =>
      getCanonicalAppOrigin("https://internal/request", {
        NODE_ENV: "test",
        APP_ORIGIN: "https://retro.example/app",
      }),
    /path/,
  );
  assert.throws(
    () =>
      getCanonicalAppOrigin("https://internal/request", {
        NODE_ENV: "test",
        APP_ORIGIN: "https://retro.example/",
      }),
    /path/,
  );
  assert.equal(
    getCanonicalAppOrigin("http://localhost:3000/api/boards", { NODE_ENV: "test" }),
    "http://localhost:3000",
  );
});

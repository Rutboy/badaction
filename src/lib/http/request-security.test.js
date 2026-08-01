import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../errors/api-error-base.ts";
import {
  JSON_BODY_LIMIT_BYTES,
  assertNoRequestBody,
  assertSameOriginMutation,
  readJsonBody,
} from "./request-security.ts";

const expectApiError = async (promise, status, code) => {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, status);
    assert.equal(error.code, code);
    return true;
  });
};

test("accepts same-origin mutations and rejects cross-site requests", () => {
  assert.doesNotThrow(() =>
    assertSameOriginMutation(
      new Request("https://retro.example/api/boards", {
        method: "POST",
        headers: {
          origin: "https://retro.example",
          "sec-fetch-site": "same-origin",
        },
      }),
      {},
    ),
  );

  assert.throws(
    () =>
      assertSameOriginMutation(
        new Request("https://retro.example/api/boards", {
          method: "POST",
          headers: { "sec-fetch-site": "cross-site" },
        }),
        {},
      ),
    (error) => error instanceof ApiError && error.status === 403,
  );

  assert.throws(
    () =>
      assertSameOriginMutation(
        new Request("https://retro.example/api/boards", {
          method: "POST",
          headers: { origin: "https://attacker.example" },
        }),
        {},
      ),
    (error) => error instanceof ApiError && error.status === 403,
  );
});

test("uses APP_ORIGIN instead of an internal request URL in production", () => {
  assert.doesNotThrow(() =>
    assertSameOriginMutation(
      new Request("http://internal:3000/api/boards", {
        method: "POST",
        headers: { origin: "https://retro.example" },
      }),
      {
        NODE_ENV: "production",
        APP_ORIGIN: "https://retro.example",
      },
    ),
  );

  assert.throws(
    () =>
      assertSameOriginMutation(
        new Request("https://retro.example/api/boards", {
          method: "POST",
          headers: { origin: "https://internal.example" },
        }),
        {
          NODE_ENV: "production",
          APP_ORIGIN: "https://retro.example",
        },
      ),
    (error) => error instanceof ApiError && error.status === 403,
  );
});

test("reads a valid JSON request with a supported media type", async () => {
  const payload = await readJsonBody(
    new Request("https://retro.example/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text: "Привет 🚀" }),
    }),
  );

  assert.deepEqual(payload, { text: "Привет 🚀" });
});

test("maps unsupported media type and invalid JSON to client errors", async () => {
  await expectApiError(
    readJsonBody(
      new Request("https://retro.example/api/cards", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    ),
    415,
    "UNSUPPORTED_MEDIA_TYPE",
  );

  await expectApiError(
    readJsonBody(
      new Request("https://retro.example/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{broken",
      }),
    ),
    400,
    "INVALID_JSON",
  );
});

test("enforces the JSON body limit using streamed UTF-8 bytes", async () => {
  const multibyteBody = JSON.stringify({ text: "я".repeat(JSON_BODY_LIMIT_BYTES / 2) });

  await expectApiError(
    readJsonBody(
      new Request("https://retro.example/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: multibyteBody,
      }),
    ),
    413,
    "PAYLOAD_TOO_LARGE",
  );
});

test("accepts an absent body and rejects unexpected streamed bodies", async () => {
  await assert.doesNotReject(
    assertNoRequestBody(new Request("https://retro.example/api/boards", { method: "POST" })),
  );

  await expectApiError(
    assertNoRequestBody(
      new Request("https://retro.example/api/boards", {
        method: "POST",
        body: "{}",
      }),
    ),
    400,
    "UNEXPECTED_REQUEST_BODY",
  );

  await expectApiError(
    assertNoRequestBody(
      new Request("https://retro.example/api/boards", {
        method: "POST",
        body: "x".repeat(JSON_BODY_LIMIT_BYTES + 1),
      }),
    ),
    413,
    "PAYLOAD_TOO_LARGE",
  );
});

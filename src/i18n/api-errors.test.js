import test from "node:test";
import assert from "node:assert/strict";
import { readApiError, translateApiErrorPayload } from "./api-errors.ts";
import { SUPPORTED_LOCALES } from "./locales.ts";
import { messages } from "./messages/index.ts";
import { createTranslator } from "./translate.ts";

const knownErrorCodes = Object.keys(messages.en.errors.api).sort();

test("every registered API error code resolves in every locale", () => {
  assert.ok(knownErrorCodes.length > 0);

  for (const locale of SUPPORTED_LOCALES) {
    const t = createTranslator(locale);
    for (const code of knownErrorCodes) {
      assert.equal(
        translateApiErrorPayload({ error: { code } }, t),
        t(`errors.api.${code}`),
        `${locale}:${code}`,
      );
    }
  }
});

test("unknown API codes use the localized generic or caller fallback", () => {
  const payload = {
    error: {
      code: "A_NEW_SERVER_CODE",
      message: "Sensitive server detail that must not be displayed",
    },
  };

  for (const locale of SUPPORTED_LOCALES) {
    const t = createTranslator(locale);
    assert.equal(translateApiErrorPayload(payload, t), t("errors.unknown"));
    assert.equal(
      translateApiErrorPayload(payload, t, "home.createFailed"),
      t("home.createFailed"),
    );
  }
});

test("invalid payload shapes use invalid-response text and ignore server messages", () => {
  const invalidPayloads = [
    undefined,
    null,
    "error",
    42,
    true,
    [],
    {},
    { error: null },
    { error: "BOARD_NOT_FOUND" },
    { error: {} },
    { error: { code: null } },
    { error: { code: 404 } },
    { error: { message: "Board not found" } },
  ];

  for (const locale of SUPPORTED_LOCALES) {
    const t = createTranslator(locale);
    for (const payload of invalidPayloads) {
      assert.equal(
        translateApiErrorPayload(payload, t),
        t("errors.invalidResponse"),
        `${locale}:${JSON.stringify(payload)}`,
      );
    }
  }
});

test("known errors pass only finite numeric and string details to translation", () => {
  let translatedKey;
  let translatedValues;
  const t = (key, values) => {
    translatedKey = key;
    translatedValues = values;
    return "translated";
  };

  assert.equal(
    translateApiErrorPayload(
      {
        error: {
          code: "BOARD_CARD_LIMIT_REACHED",
          details: {
            limit: 500,
            field: "cards",
            infinity: Number.POSITIVE_INFINITY,
            notANumber: Number.NaN,
            enabled: true,
            empty: null,
            nested: { secret: "not exposed" },
            list: ["not exposed"],
          },
        },
      },
      t,
    ),
    "translated",
  );
  assert.equal(translatedKey, "errors.api.BOARD_CARD_LIMIT_REACHED");
  assert.deepEqual(translatedValues, { limit: 500, field: "cards" });
});

test("malformed details are ignored for otherwise known errors", () => {
  for (const details of [undefined, null, "details", 5, true, [], ["value"]]) {
    let translatedValues;
    const t = (_key, values) => {
      translatedValues = values;
      return "translated";
    };

    assert.equal(
      translateApiErrorPayload(
        { error: { code: "BOARD_NOT_FOUND", details } },
        t,
      ),
      "translated",
    );
    assert.deepEqual(translatedValues, {});
  }
});

test("readApiError localizes valid JSON and rejects invalid response bodies", async () => {
  const t = createTranslator("es");
  const knownResponse = new Response(
    JSON.stringify({ error: { code: "BOARD_NOT_FOUND" } }),
    { status: 404, headers: { "content-type": "application/json" } },
  );
  assert.equal(
    await readApiError(knownResponse, t),
    t("errors.api.BOARD_NOT_FOUND"),
  );

  const unknownResponse = new Response(
    JSON.stringify({ error: { code: "FUTURE_ERROR" } }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
  assert.equal(
    await readApiError(unknownResponse, t, "join.redeemFailed"),
    t("join.redeemFailed"),
  );

  const invalidJsonResponse = new Response("not JSON", {
    status: 502,
    headers: { "content-type": "application/json" },
  });
  assert.equal(
    await readApiError(invalidJsonResponse, t),
    t("errors.invalidResponse"),
  );
});

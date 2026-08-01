import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOCALE,
  getLocaleCookieOptions,
  isLocale,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  LOCALE_NAMES,
  normalizeLocale,
  parseSavedLocale,
  SUPPORTED_LOCALES,
} from "./locales.ts";
import { localeFromAcceptLanguage, resolveLocale } from "./resolve-locale.ts";

test("locale constants expose the exact supported product languages", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["en", "ru", "es"]);
  assert.equal(DEFAULT_LOCALE, "en");
  assert.equal(LOCALE_COOKIE_NAME, "badaction_locale");
  assert.equal(LOCALE_COOKIE_MAX_AGE, 60 * 60 * 24 * 365);
  assert.deepEqual(LOCALE_NAMES, {
    en: "English",
    ru: "Русский",
    es: "Español",
  });
});

test("normalizes browser locales and falls back to English", () => {
  const cases = [
    ["ru", "ru"],
    ["ru-RU", "ru"],
    ["ru-KZ", "ru"],
    ["RU_ru", "ru"],
    ["es", "es"],
    ["es-ES", "es"],
    ["es-MX", "es"],
    ["es-AR", "es"],
    ["EN", "en"],
    ["en-US", "en"],
    ["en-GB", "en"],
    ["de-DE", "en"],
    ["fr-FR", "en"],
    ["unknown", "en"],
    ["", "en"],
    ["   ", "en"],
    ["-ru", "en"],
    ["ru-", "en"],
    ["es-@@", "en"],
    ["en--US", "en"],
    ["ru-💥", "en"],
    ["en_", "en"],
    [null, "en"],
    [undefined, "en"],
    [42, "en"],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normalizeLocale(input), expected, String(input));
  }
});

test("saved locale parsing uses a strict allowlist", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.equal(isLocale(locale), true);
    assert.equal(parseSavedLocale(locale), locale);
  }

  for (const invalid of [
    "EN",
    "ru-RU",
    " es ",
    "de",
    "",
    null,
    undefined,
    1,
    {},
  ]) {
    assert.equal(isLocale(invalid), false, String(invalid));
    assert.equal(parseSavedLocale(invalid), null, String(invalid));
  }
});

test("Accept-Language honors quality, source order, exclusions, and fallback", () => {
  const cases = [
    ["ru-RU,ru;q=0.9,en;q=0.8", "ru"],
    ["es-MX,es;q=0.9,en;q=0.8", "es"],
    ["es-MX;q=0.4, ru-RU;q=0.9, en;q=0.8", "ru"],
    ["es;q=0.8,ru;q=0.8", "es"],
    ["de-DE;q=1,es-MX;q=0.9", "es"],
    ["de-DE;q=1,en-GB;q=0.7", "en"],
    ["ru;q=0,en;q=0.5", "en"],
    ["ru;q=invalid,es;q=0.5", "es"],
    ["es;q=1.1,ru;q=0.5", "ru"],
    ["*;q=1,ru;q=0.4", "ru"],
    ["de-DE", "en"],
    ["unknown", "en"],
    ["ru-", "en"],
    ["es-@@", "en"],
    ["en--US", "en"],
    ["", "en"],
    ["   ", "en"],
    [null, "en"],
    [undefined, "en"],
  ];

  for (const [header, expected] of cases) {
    assert.equal(localeFromAcceptLanguage(header), expected, String(header));
  }
});

test("saved manual choice takes priority and an invalid cookie is ignored", () => {
  assert.equal(
    resolveLocale({ savedLocale: "ru", acceptLanguage: "es-MX,en;q=0.8" }),
    "ru",
  );
  assert.equal(
    resolveLocale({ savedLocale: "en", acceptLanguage: "ru-RU,ru;q=0.9" }),
    "en",
  );
  assert.equal(
    resolveLocale({ savedLocale: "de", acceptLanguage: "es-MX,es;q=0.9" }),
    "es",
  );
  assert.equal(
    resolveLocale({ savedLocale: "RU", acceptLanguage: "ru-KZ,ru;q=0.9" }),
    "ru",
  );
  assert.equal(
    resolveLocale({ savedLocale: "invalid", acceptLanguage: "de-DE" }),
    "en",
  );
  assert.equal(resolveLocale({}), "en");
});

test("locale cookie options are site-wide, long-lived, lax, and production-secure", () => {
  const previousNodeEnvironment = process.env.NODE_ENV;

  try {
    process.env.NODE_ENV = "test";
    assert.deepEqual(getLocaleCookieOptions(), {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: false,
    });

    process.env.NODE_ENV = "production";
    assert.deepEqual(getLocaleCookieOptions(), {
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: true,
    });
  } finally {
    if (previousNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnvironment;
    }
  }
});

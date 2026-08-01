import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LOCALES } from "./locales.ts";
import { messages } from "./messages/index.ts";
import { createTranslator } from "./translate.ts";

const placeholders = (template) =>
  [...template.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)]
    .map((match) => match[1])
    .sort();

const uniquePlaceholders = (templates) =>
  [...new Set(templates.flatMap(placeholders))].sort();

const flattenMessages = (value, prefix = "", result = new Map()) => {
  assert.equal(
    typeof value,
    "object",
    `${prefix || "dictionary"} must be an object`,
  );
  assert.notEqual(value, null, `${prefix || "dictionary"} must not be null`);
  assert.equal(
    Array.isArray(value),
    false,
    `${prefix || "dictionary"} must not be an array`,
  );

  for (const [name, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (typeof child === "string") {
      result.set(path, { kind: "string", templates: [child] });
      continue;
    }

    if (child && typeof child === "object" && child._kind === "plural") {
      assert.equal(
        typeof child.forms,
        "object",
        `${path} plural forms must be an object`,
      );
      assert.notEqual(
        child.forms,
        null,
        `${path} plural forms must not be null`,
      );
      assert.equal(
        typeof child.forms.other,
        "string",
        `${path} must define an other plural form`,
      );
      result.set(path, {
        kind: "plural",
        templates: Object.values(child.forms),
      });
      continue;
    }

    flattenMessages(child, path, result);
  }

  return result;
};

test("all locale dictionaries have identical nonempty message leaves", () => {
  const flattened = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      flattenMessages(messages[locale]),
    ]),
  );
  const englishKeys = [...flattened.en.keys()].sort();
  assert.ok(englishKeys.length > 0);

  for (const locale of SUPPORTED_LOCALES) {
    const localeMessages = flattened[locale];
    assert.deepEqual(
      [...localeMessages.keys()].sort(),
      englishKeys,
      `${locale} keys`,
    );

    for (const key of englishKeys) {
      const english = flattened.en.get(key);
      const localized = localeMessages.get(key);
      assert.ok(english, `English message ${key} must exist`);
      assert.ok(localized, `${locale} message ${key} must exist`);
      assert.equal(localized.kind, english.kind, `${locale}:${key} leaf kind`);
      assert.ok(localized.templates.length > 0, `${locale}:${key} templates`);

      for (const template of localized.templates) {
        assert.equal(
          typeof template,
          "string",
          `${locale}:${key} template type`,
        );
        assert.notEqual(
          template.trim(),
          "",
          `${locale}:${key} must not be empty`,
        );
      }
    }
  }
});

test("interpolation placeholders match English in every locale and plural form", () => {
  const flattened = Object.fromEntries(
    SUPPORTED_LOCALES.map((locale) => [
      locale,
      flattenMessages(messages[locale]),
    ]),
  );

  for (const [key, english] of flattened.en) {
    const expected = uniquePlaceholders(english.templates);

    for (const locale of SUPPORTED_LOCALES) {
      const localized = flattened[locale].get(key);
      assert.ok(localized, `${locale} message ${key} must exist`);
      assert.deepEqual(
        uniquePlaceholders(localized.templates),
        expected,
        `${locale}:${key} placeholder set`,
      );

      if (localized.kind === "plural") {
        for (const template of localized.templates) {
          assert.deepEqual(
            placeholders(template),
            expected,
            `${locale}:${key} plural form placeholders`,
          );
        }
      }
    }
  }
});

test("translator interpolates values without assembling message fragments", () => {
  assert.equal(
    createTranslator("en")("language.current", { language: "English" }),
    "Current language: English",
  );
  assert.equal(
    createTranslator("ru")("language.current", { language: "Русский" }),
    "Текущий язык: Русский",
  );
  assert.equal(
    createTranslator("es")("language.current", { language: "Español" }),
    "Idioma actual: Español",
  );
  assert.equal(
    createTranslator("en")("language.current"),
    "Current language: {language}",
  );
});

test("pluralization follows English, Russian, and Spanish rules", () => {
  const en = createTranslator("en");
  const ru = createTranslator("ru");
  const es = createTranslator("es");

  assert.equal(en("counts.votes", { count: 0 }), "0 votes");
  assert.equal(en("counts.votes", { count: 1 }), "1 vote");
  assert.equal(en("counts.votes", { count: 2 }), "2 votes");

  assert.equal(ru("counts.votes", { count: 1 }), "1 голос");
  assert.equal(ru("counts.votes", { count: 2 }), "2 голоса");
  assert.equal(ru("counts.votes", { count: 5 }), "5 голосов");
  assert.equal(ru("counts.votes", { count: 21 }), "21 голос");
  assert.equal(ru("counts.votes", { count: 22 }), "22 голоса");
  assert.equal(ru("counts.votes", { count: 25 }), "25 голосов");

  assert.equal(es("counts.votes", { count: 0 }), "0 votos");
  assert.equal(es("counts.votes", { count: 1 }), "1 voto");
  assert.equal(es("counts.votes", { count: 2 }), "2 votos");
});

test("translator safely falls back to English and exposes a missing key literally", () => {
  const russianHomeTitle = messages.ru.home.title;
  assert.equal(Reflect.deleteProperty(messages.ru.home, "title"), true);
  try {
    assert.equal(createTranslator("ru")("home.title"), messages.en.home.title);
  } finally {
    messages.ru.home.title = russianHomeTitle;
  }

  const unsupportedLocaleTranslator = createTranslator("de");
  assert.equal(
    unsupportedLocaleTranslator("home.title"),
    messages.en.home.title,
  );
  assert.equal(
    unsupportedLocaleTranslator("counts.participants", { count: 2 }),
    "2 participants",
  );

  const missingKey = "errors.api.NOT_A_REAL_CODE";
  assert.equal(createTranslator("en")(missingKey), missingKey);
});

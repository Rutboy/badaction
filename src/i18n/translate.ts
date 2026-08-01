import type { Locale } from "./locales.ts";
import { messages, type MessageKey } from "./messages/index.ts";
import type { MessageLeaf, PluralMessage } from "./messages/types.ts";

export type TranslationValues = Record<string, string | number>;
export type Translate = (key: MessageKey, values?: TranslationValues) => string;

const isPluralMessage = (value: MessageLeaf): value is PluralMessage =>
  typeof value === "object" && value !== null && value._kind === "plural";

const readMessage = (
  locale: Locale,
  key: MessageKey,
): MessageLeaf | undefined => {
  let current: unknown = messages[locale];
  for (const part of key.split(".")) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  return typeof current === "string" ||
    (typeof current === "object" && current !== null && "_kind" in current)
    ? (current as MessageLeaf)
    : undefined;
};

const interpolate = (template: string, values: TranslationValues): string =>
  template.replace(
    /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
    (placeholder, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  );

export const createTranslator = (locale: Locale): Translate => {
  const pluralRules = new Intl.PluralRules(locale);

  return (key, values = {}) => {
    const message = readMessage(locale, key) ?? readMessage("en", key);
    if (message === undefined) {
      return key;
    }

    if (!isPluralMessage(message)) {
      return interpolate(message, values);
    }

    const count = Number(values.count);
    const category = Number.isFinite(count)
      ? pluralRules.select(count)
      : "other";
    const template = message.forms[category] ?? message.forms.other;
    return interpolate(template, values);
  };
};

export const formatDate = (
  locale: Locale,
  value: Date | string | number,
  options: Intl.DateTimeFormatOptions,
): string => new Intl.DateTimeFormat(locale, options).format(new Date(value));

export const formatNumber = (
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string => new Intl.NumberFormat(locale, options).format(value);

export const formatRelativeTime = (
  locale: Locale,
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  options: Intl.RelativeTimeFormatOptions = { numeric: "auto" },
): string => new Intl.RelativeTimeFormat(locale, options).format(value, unit);

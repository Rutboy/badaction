import {
  DEFAULT_LOCALE,
  type Locale,
  normalizeLocale,
  parseSavedLocale,
} from "./locales.ts";

type LanguagePreference = {
  locale: string;
  quality: number;
  index: number;
};

const parseQuality = (parameters: readonly string[]): number => {
  const qualityParameter = parameters.find((parameter) =>
    parameter.trim().toLowerCase().startsWith("q="),
  );
  if (!qualityParameter) {
    return 1;
  }

  const quality = Number(qualityParameter.trim().slice(2));
  return Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0;
};

export const localeFromAcceptLanguage = (header: unknown): Locale => {
  if (typeof header !== "string" || header.trim() === "") {
    return DEFAULT_LOCALE;
  }

  const preferences: LanguagePreference[] = header
    .split(",")
    .map((entry, index) => {
      const [locale = "", ...parameters] = entry.split(";");
      return {
        locale: locale.trim(),
        quality: parseQuality(parameters),
        index,
      };
    })
    .filter(
      ({ locale, quality }) => locale !== "" && locale !== "*" && quality > 0,
    )
    .sort(
      (left, right) => right.quality - left.quality || left.index - right.index,
    );

  for (const preference of preferences) {
    const normalized = normalizeLocale(preference.locale);
    if (
      normalized !== DEFAULT_LOCALE ||
      /^en(?:[-_]|$)/i.test(preference.locale)
    ) {
      return normalized;
    }
  }

  return DEFAULT_LOCALE;
};

export const resolveLocale = ({
  savedLocale,
  acceptLanguage,
}: {
  savedLocale?: unknown;
  acceptLanguage?: unknown;
}): Locale =>
  parseSavedLocale(savedLocale) ?? localeFromAcceptLanguage(acceptLanguage);

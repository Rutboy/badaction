export const SUPPORTED_LOCALES = ["en", "ru", "es"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE_NAME = "badaction_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  es: "Español",
};

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" &&
  (SUPPORTED_LOCALES as readonly string[]).includes(value);

export const parseSavedLocale = (value: unknown): Locale | null =>
  isLocale(value) ? value : null;

export const normalizeLocale = (value: unknown): Locale => {
  if (typeof value !== "string") {
    return DEFAULT_LOCALE;
  }

  const language = value
    .trim()
    .replaceAll("_", "-")
    .split("-", 1)[0]
    ?.toLowerCase();
  return isLocale(language) ? language : DEFAULT_LOCALE;
};

export const getLocaleCookieOptions = () => ({
  path: "/",
  maxAge: LOCALE_COOKIE_MAX_AGE,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
});

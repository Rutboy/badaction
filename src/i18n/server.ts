import { cache } from "react";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE_NAME } from "./locales.ts";
import { resolveLocale } from "./resolve-locale.ts";
import { createTranslator } from "./translate.ts";

export const getRequestLocale = cache(async () => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale({
    savedLocale: cookieStore.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: headerStore.get("accept-language"),
  });
});

export const getServerI18n = cache(async () => {
  const locale = await getRequestLocale();
  return { locale, t: createTranslator(locale) };
});

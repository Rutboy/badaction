"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getLocaleCookieOptions,
  isLocale,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "./locales.ts";
import {
  createTranslator,
  formatDate,
  formatNumber,
  formatRelativeTime,
  type Translate,
} from "./translate.ts";

type I18nContextValue = {
  locale: Locale;
  t: Translate;
  setLocale: (locale: Locale) => void;
  formatDate: (
    value: Date | string | number,
    options: Intl.DateTimeFormatOptions,
  ) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
  formatRelativeTime: (
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options?: Intl.RelativeTimeFormatOptions,
  ) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const writeLocaleCookie = (locale: Locale) => {
  const options = getLocaleCookieOptions();
  const secure = options.secure ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; Path=${options.path}; Max-Age=${options.maxAge}; SameSite=Lax${secure}`;
};

export const I18nProvider = ({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) => {
  const router = useRouter();
  const [locale, setCurrentLocale] = useState(initialLocale);

  useEffect(() => {
    setCurrentLocale(initialLocale);
  }, [initialLocale]);

  const setLocale = useCallback(
    (nextLocale: Locale) => {
      if (!isLocale(nextLocale)) {
        return;
      }
      writeLocaleCookie(nextLocale);
      // Selecting the already inferred locale is still an explicit preference:
      // persist it so it keeps priority if the browser locale changes later.
      if (nextLocale === locale) {
        return;
      }
      const nextTranslator = createTranslator(nextLocale);
      document.documentElement.lang = nextLocale;
      document.title = nextTranslator("metadata.title");
      setCurrentLocale(nextLocale);
      startTransition(() => router.refresh());
    },
    [locale, router],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      t: createTranslator(locale),
      setLocale,
      formatDate: (dateValue, options) =>
        formatDate(locale, dateValue, options),
      formatNumber: (numberValue, options) =>
        formatNumber(locale, numberValue, options),
      formatRelativeTime: (relativeValue, unit, options) =>
        formatRelativeTime(locale, relativeValue, unit, options),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nProvider");
  }
  return value;
};

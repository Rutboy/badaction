import { isLocale } from "./locales.ts";
import { createTranslator } from "./translate.ts";

const DEFAULT_BOARD_COLUMN_DEFINITIONS = [
  { titleKey: "defaultColumns.wentWell", position: 1024, voteLimit: 3 },
  { titleKey: "defaultColumns.couldImprove", position: 2048, voteLimit: 3 },
] as const;

export const getDefaultBoardColumns = (locale: unknown = "en") => {
  const t = createTranslator(isLocale(locale) ? locale : "en");
  return DEFAULT_BOARD_COLUMN_DEFINITIONS.map(({ titleKey, ...column }) => ({
    ...column,
    title: t(titleKey),
  }));
};

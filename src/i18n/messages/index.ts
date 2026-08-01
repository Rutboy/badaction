import type { Locale } from "../locales.ts";
import { boardShellEn, boardShellEs, boardShellRu } from "./board-shell.ts";
import { contentEn, contentEs, contentRu } from "./content.ts";
import { coreEn, coreEs, coreRu } from "./core.ts";
import { settingsEn, settingsEs, settingsRu } from "./settings.ts";
import type { MessagePath, MessageShape } from "./types.ts";

const en = {
  ...coreEn,
  ...contentEn,
  ...boardShellEn,
  ...settingsEn,
} as const;
const ru = {
  ...coreRu,
  ...contentRu,
  ...boardShellRu,
  ...settingsRu,
} satisfies MessageShape<typeof en>;
const es = {
  ...coreEs,
  ...contentEs,
  ...boardShellEs,
  ...settingsEs,
} satisfies MessageShape<typeof en>;

export const messages = { en, ru, es } as const satisfies Record<
  Locale,
  MessageShape<typeof en>
>;

export type Messages = typeof en;
export type MessageKey = MessagePath<Messages>;

import type { GroupView } from "./services/content-types.ts";

export const getGroupDisplayTitle = (
  group: Pick<GroupView, "title" | "primaryCardId" | "cards">,
): string | null =>
  group.title ??
  group.cards.find((card) => card.id === group.primaryCardId)?.text ??
  null;

import test from "node:test";
import assert from "node:assert/strict";
import { getGroupDisplayTitle } from "./group-display.ts";

const cards = [
  { id: "card-a", text: "Первый текст" },
  { id: "card-b", text: "Текст основной карточки" },
];

test("group display title prefers the explicit title and falls back to the primary card", () => {
  assert.equal(
    getGroupDisplayTitle({
      title: "Название группы",
      primaryCardId: "card-b",
      cards,
    }),
    "Название группы",
  );
  assert.equal(
    getGroupDisplayTitle({ title: null, primaryCardId: "card-b", cards }),
    "Текст основной карточки",
  );
});

test("group display title stays null for an invalid group payload", () => {
  assert.equal(
    getGroupDisplayTitle({ title: null, primaryCardId: "missing", cards }),
    null,
  );
});

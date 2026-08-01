import test from "node:test";
import assert from "node:assert/strict";
import { createCardSchema } from "./cards.ts";

test("ACTIONS card requires owner", () => {
  const result = createCardSchema.safeParse({
    column: "ACTIONS",
    text: "Добавить шаблон приёмки",
    owner: null,
  });

  assert.equal(result.success, false);
});

test("non-ACTIONS card rejects owner", () => {
  const result = createCardSchema.safeParse({
    column: "WENT_WELL",
    text: "Команда быстро закрыла баг",
    owner: "Оля",
  });

  assert.equal(result.success, false);
});

test("valid non-ACTIONS card passes", () => {
  const result = createCardSchema.safeParse({
    column: "TO_IMPROVE",
    text: "Стоит сократить цикл ревью",
    owner: null,
  });

  assert.equal(result.success, true);
});

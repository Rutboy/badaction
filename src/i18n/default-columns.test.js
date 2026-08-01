import test from "node:test";
import assert from "node:assert/strict";
import { getDefaultBoardColumns } from "./default-columns.ts";

const layout = (titles) => [
  { title: titles[0], position: 1024, voteLimit: 3 },
  { title: titles[1], position: 2048, voteLimit: 3 },
];

test("returns exactly two localized persisted default columns", () => {
  const cases = [
    ["en", ["Went well", "Could improve"]],
    ["ru", ["Что прошло хорошо", "Что можно улучшить"]],
    ["es", ["Salió bien", "Se puede mejorar"]],
  ];

  for (const [locale, titles] of cases) {
    assert.deepEqual(getDefaultBoardColumns(locale), layout(titles), locale);
  }
});

test("uses English for an omitted or unsupported locale", () => {
  const english = layout(["Went well", "Could improve"]);

  assert.deepEqual(getDefaultBoardColumns(), english);
  assert.deepEqual(getDefaultBoardColumns("de-DE"), english);
  assert.deepEqual(getDefaultBoardColumns("unknown"), english);
  assert.deepEqual(getDefaultBoardColumns(null), english);
});

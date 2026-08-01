import test from "node:test";
import assert from "node:assert/strict";
import { neutralizeSpreadsheetFormula, toCsv } from "./export-csv.ts";

test("neutralizes spreadsheet formula prefixes, including leading whitespace", () => {
  for (const value of ["=1+1", "+cmd", "-2+3", "@SUM(A1:A2)", "  =1+1", "\t=1+1"]) {
    assert.equal(neutralizeSpreadsheetFormula(value), `'${value}`);
  }

  assert.equal(neutralizeSpreadsheetFormula("Обычный текст"), "Обычный текст");
});

test("exports UTF-8 CSV with BOM, escaped content, and neutralized user fields", () => {
  const csv = toCsv([
    {
      cardId: "2d140dbd-31b3-4e48-b6f6-6fb7ddc28d24",
      boardId: "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2",
      column: "ACTIONS",
      text: "=HYPERLINK(\"https://example.test\")\nГотово 🚀",
      likesCount: 0,
      owner: "+Оля",
      createdAt: "2026-07-31T10:00:00.000Z",
    },
  ]);

  assert.equal(csv.startsWith("\uFEFFcardId,boardId,column,columnLabel,text,likesCount,owner,createdAt\n"), true);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.test""\)\nГотово 🚀"/);
  assert.match(csv, /,"'\+Оля",/);
});

test("exports a null owner as an empty quoted cell", () => {
  const csv = toCsv([
    {
      cardId: "2d140dbd-31b3-4e48-b6f6-6fb7ddc28d24",
      boardId: "e3033b7f-58e4-42a5-b2fa-1a98069f3aa2",
      column: "WENT_WELL",
      text: "Хорошая коммуникация",
      likesCount: 2,
      owner: null,
      createdAt: "2026-07-31T10:00:00.000Z",
    },
  ]);

  assert.match(csv, /,2,"","2026-07-31T10:00:00\.000Z"$/);
});

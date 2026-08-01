import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { toCsv } from "../csv/export-csv.ts";
import { serializeCurrentJsonExport } from "./current-export.ts";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const EXPORTED_AT = new Date("2026-07-31T12:00:00.000Z");
const FIXTURE_DIRECTORY = new URL(
  "../../../tests/fixtures/stage0/exports/",
  import.meta.url,
);

const rows = [
  {
    likesCount: 2,
    createdAt: "2026-07-31T10:03:00.000Z",
    owner: null,
    text: "Стабильный релиз 🚀",
    columnLabel: "Уже хорошо",
    column: "WENT_WELL",
    boardId: BOARD_ID,
    cardId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  },
  {
    cardId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    boardId: BOARD_ID,
    column: "TO_IMPROVE",
    columnLabel: "Следует улучшить",
    text: "  =HYPERLINK(\"https://example.test\")\nНужны тесты",
    likesCount: 1,
    owner: null,
    createdAt: "2026-07-31T10:02:00.000Z",
  },
  {
    cardId: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    boardId: BOARD_ID,
    column: "ACTIONS",
    columnLabel: "Решения",
    text: "Созвониться с \"командой\"",
    likesCount: 0,
    owner: "+Оля",
    createdAt: "2026-07-31T10:01:00.000Z",
  },
];

test("current JSON and CSV exports match the stage 0 golden fixtures byte-for-byte", async () => {
  const [expectedJson, expectedCsv] = await Promise.all([
    readFile(new URL("current-export.json", FIXTURE_DIRECTORY)),
    readFile(new URL("current-export.csv", FIXTURE_DIRECTORY)),
  ]);

  const actualJson = Buffer.from(serializeCurrentJsonExport({
    boardId: BOARD_ID,
    exportedAt: EXPORTED_AT,
    cards: rows,
  }));
  const actualCsv = Buffer.from(toCsv(rows));

  assert.deepEqual(actualJson, expectedJson);
  assert.deepEqual(actualCsv, expectedCsv);
});

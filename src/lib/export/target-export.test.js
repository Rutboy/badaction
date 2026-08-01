import test from "node:test";
import assert from "node:assert/strict";
import {
  escapeTargetMarkdown,
  neutralizeTargetCsvFormula,
  projectTargetExport,
  serializeTargetCsvExport,
  serializeTargetJsonExport,
  serializeTargetMarkdownExport,
  TARGET_CSV_HEADER,
} from "./target-export.ts";

const BOARD_ID = "11111111-1111-4111-8111-111111111111";
const COLUMN_A = "22222222-2222-4222-8222-222222222222";
const COLUMN_B = "33333333-3333-4333-8333-333333333333";
const CARD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CARD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const CARD_C = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const GROUP_ID = "44444444-4444-4444-8444-444444444444";
const ACTION_A = "55555555-5555-4555-8555-555555555555";
const ACTION_B = "66666666-6666-4666-8666-666666666666";

const exportData = {
  schemaVersion: 2,
  exportedAt: "2026-07-31T12:00:00.000Z",
  revision: "private-revision",
  visitorIdentity: "private-visitor",
  viewer: { role: "OWNER" },
  board: {
    id: BOARD_ID,
    title: "=Ретро & <команда>",
    createdAt: "2026-07-31T10:00:00.000Z",
    expiresAt: "2026-10-29T10:00:00.000Z",
    membershipId: "private-membership",
    settings: {
      cardsEnabled: true,
      votingEnabled: false,
      readOnly: false,
    },
  },
  columns: [
    {
      id: COLUMN_A,
      title: "Уже *хорошо*",
      position: 1024,
      voteLimit: 3,
      items: [
        {
          kind: "CARD",
          id: CARD_A,
          position: 1024,
          text: "Стабильный \"релиз\"\n🚀",
          author: null,
          voteCount: 2,
          quotaSlot: 1,
          createdByMembershipId: "private-membership",
          createdAt: "2026-07-31T10:01:00.000Z",
          updatedAt: "2026-07-31T10:02:00.000Z",
        },
        {
          kind: "GROUP",
          id: GROUP_ID,
          position: 2048,
          title: "API_[ядро]",
          primaryCardId: CARD_B,
          voteCount: 3,
          cards: [
            {
              kind: "CARD",
              id: CARD_B,
              position: 1024,
              text: "=HYPERLINK(\"x\")",
              author: "+Оля",
              voteCount: 1,
              createdAt: "2026-07-31T10:03:00.000Z",
              updatedAt: "2026-07-31T10:03:00.000Z",
            },
            {
              kind: "CARD",
              id: CARD_C,
              position: 2048,
              text: "HTML <script>alert(1)</script>",
              author: "Иван & Ко",
              voteCount: 2,
              createdAt: "2026-07-31T10:04:00.000Z",
              updatedAt: "2026-07-31T10:05:00.000Z",
            },
          ],
          createdAt: "2026-07-31T10:03:00.000Z",
          updatedAt: "2026-07-31T10:05:00.000Z",
        },
      ],
    },
    {
      id: COLUMN_B,
      title: "Следует улучшить",
      position: 2048,
      voteLimit: 0,
      items: [],
    },
  ],
  actionItems: [
    {
      id: ACTION_A,
      text: "Обновить DoD\nдо пятницы",
      assignee: "@Оля",
      completed: false,
      position: 1024,
      sourceCardId: CARD_B,
      createdAt: "2026-07-31T10:06:00.000Z",
      updatedAt: "2026-07-31T10:06:00.000Z",
    },
    {
      id: ACTION_B,
      text: "Закрыть <script>",
      assignee: null,
      completed: true,
      position: 2048,
      sourceCardId: null,
      createdAt: "2026-07-31T10:07:00.000Z",
      updatedAt: "2026-07-31T10:08:00.000Z",
    },
  ],
};

test("projects the exact JSON v2 contract without internal viewer or identity fields", () => {
  const projected = projectTargetExport(exportData);
  const json = serializeTargetJsonExport(exportData);
  const parsed = JSON.parse(json);

  assert.deepEqual(parsed, projected);
  assert.equal(parsed.schemaVersion, 2);
  assert.equal(parsed.columns[0].items[1].cards[1].author, "Иван & Ко");
  assert.equal(parsed.actionItems[0].sourceCardId, CARD_B);

  for (const forbidden of [
    "revision",
    "visitorIdentity",
    "viewer",
    "membershipId",
    "createdByMembershipId",
    "quotaSlot",
    "viewerHasVoted",
  ]) {
    assert.equal(json.includes(forbidden), false, forbidden);
  }
});

test("normalizes columns, top-level items, originals, and actions to contract order", () => {
  const shuffled = structuredClone(exportData);
  shuffled.columns.reverse();
  shuffled.actionItems.reverse();
  const firstColumn = shuffled.columns.find((column) => column.id === COLUMN_A);
  firstColumn.items.reverse();
  const group = firstColumn.items.find((item) => item.kind === "GROUP");
  group.position = 1024;
  group.cards.reverse();

  const projected = projectTargetExport(shuffled);
  assert.deepEqual(projected.columns.map((column) => column.id), [COLUMN_A, COLUMN_B]);
  assert.deepEqual(projected.columns[0].items.map((item) => item.kind), ["CARD", "GROUP"]);
  assert.deepEqual(projected.columns[0].items[1].cards.map((card) => card.id), [CARD_B, CARD_C]);
  assert.deepEqual(projected.actionItems.map((actionItem) => actionItem.id), [ACTION_A, ACTION_B]);
});

test("CSV follows the exact header, row order, quoting, BOM, and formula policy", () => {
  const csv = serializeTargetCsvExport(exportData);

  assert.equal(csv.startsWith(`\uFEFF${TARGET_CSV_HEADER.join(",")}\n`), true);
  assert.equal(csv.endsWith("\n"), true);
  assert.equal((csv.match(/"BOARD"/g) ?? []).length, 1);
  assert.equal((csv.match(/"COLUMN"/g) ?? []).length, 2);
  assert.equal((csv.match(/"CARD"/g) ?? []).length, 3);
  assert.equal((csv.match(/"ACTION_ITEM"/g) ?? []).length, 2);
  assert.equal(csv.includes('"GROUP"'), false);

  assert.match(csv, /"'=Ретро & <команда>"/);
  assert.match(csv, /"Стабильный ""релиз""\n🚀"/);
  assert.match(csv, /"'=HYPERLINK\(""x""\)"/);
  assert.match(csv, /"'\+Оля"/);
  assert.match(csv, /"'@Оля"/);
  assert.match(csv, /,"",2,/);
  assert.match(csv, new RegExp(`${GROUP_ID}.*${CARD_B}`));

  for (const forbidden of ["private-revision", "private-visitor", "private-membership"]) {
    assert.equal(csv.includes(forbidden), false);
  }
});

test("CSV neutralizes all contract formula and C0 prefixes", () => {
  for (const value of [
    "=1+1",
    "+cmd",
    "-2+3",
    "@SUM(A1:A2)",
    "  =1+1",
    "\u0000обычный текст",
    "\u001fобычный текст",
  ]) {
    assert.equal(neutralizeTargetCsvFormula(value), `'${value}`);
  }
  assert.equal(neutralizeTargetCsvFormula("Обычный текст 🚀"), "Обычный текст 🚀");
});

test("Markdown matches the target template and safely escapes user content", () => {
  const markdown = serializeTargetMarkdownExport(exportData);

  assert.equal(
    markdown,
    `# \\=Ретро &amp; &lt;команда&gt;

- Создана: 2026-07-31T10:00:00.000Z
- Истекает: 2026-10-29T10:00:00.000Z
- Карточки: включены
- Голосование: выключено
- Только чтение: нет

## Уже \\*хорошо\\* (лимит голосов: 3)

1. Стабильный "релиз"<br>🚀
   - Автор: —
   - Голоса: 2
2. Группа: API\\_\\[ядро\\]
   - Голоса: 3
   1. \\=HYPERLINK\\("x"\\) — основная
      - Автор: \\+Оля
      - Голоса: 1
   2. HTML &lt;script&gt;alert\\(1\\)&lt;/script&gt;
      - Автор: Иван &amp; Ко
      - Голоса: 2

## Следует улучшить (лимит голосов: 0)

_Нет карточек._

## Action items

- [ ] Обновить DoD<br>до пятницы — Ответственный: @Оля
- [x] Закрыть &lt;script&gt; — Ответственный: —
`,
  );
  assert.equal(markdown.endsWith("\n"), true);
  assert.equal(markdown.endsWith("\n\n"), false);
  assert.equal(markdown.includes("<script>"), false);
  assert.equal(markdown.includes("private-"), false);
});

test("Markdown escaping normalizes internal line endings to generated safe breaks", () => {
  assert.equal(
    escapeTargetMarkdown("**bold**\r\n<script>\rnext"),
    "\\*\\*bold\\*\\*<br>&lt;script&gt;<br>next",
  );
});

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

test("Markdown localizes generated chrome and preserves escaped user content", () => {
  const dateOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  };
  const cases = {
    en: {
      createdAt: "Created",
      expiresAt: "Expires",
      cards: "Cards: yes",
      voting: "Voting: no",
      readOnly: "Read-only: no",
      voteLimit: "vote limit",
      author: "Author",
      votes: "Votes",
      group: "Group",
      primary: "primary",
      noCards: "No cards.",
      actionItems: "Action items",
      assignee: "Assignee",
    },
    ru: {
      createdAt: "Создана",
      expiresAt: "Истекает",
      cards: "Карточки: да",
      voting: "Голосование: нет",
      readOnly: "Только чтение: нет",
      voteLimit: "лимит голосов",
      author: "Автор",
      votes: "Голоса",
      group: "Группа",
      primary: "основная",
      noCards: "Нет карточек.",
      actionItems: "Решения",
      assignee: "Ответственный",
    },
    es: {
      createdAt: "Creado",
      expiresAt: "Caduca",
      cards: "Tarjetas: sí",
      voting: "Votación: no",
      readOnly: "Solo lectura: no",
      voteLimit: "límite de votos",
      author: "Autor",
      votes: "Votos",
      group: "Grupo",
      primary: "principal",
      noCards: "No hay tarjetas.",
      actionItems: "Acciones",
      assignee: "Responsable",
    },
  };

  for (const [locale, labels] of Object.entries(cases)) {
    const markdown = serializeTargetMarkdownExport(exportData, locale);
    const dateFormatter = new Intl.DateTimeFormat(locale, dateOptions);

    assert.ok(
      markdown.includes(
        `- ${labels.createdAt}: ${dateFormatter.format(new Date(exportData.board.createdAt))}`,
      ),
      locale,
    );
    assert.ok(
      markdown.includes(
        `- ${labels.expiresAt}: ${dateFormatter.format(new Date(exportData.board.expiresAt))}`,
      ),
      locale,
    );
    assert.ok(markdown.includes(`- ${labels.cards}`), locale);
    assert.ok(markdown.includes(`- ${labels.voting}`), locale);
    assert.ok(markdown.includes(`- ${labels.readOnly}`), locale);
    assert.ok(
      markdown.includes(`## Уже \\*хорошо\\* (${labels.voteLimit}: 3)`),
      locale,
    );
    assert.ok(markdown.includes(`- ${labels.author}: —`), locale);
    assert.ok(markdown.includes(`- ${labels.votes}: 2`), locale);
    assert.ok(markdown.includes(`2. ${labels.group}: API\\_\\[ядро\\]`), locale);
    assert.ok(markdown.includes(`— ${labels.primary}`), locale);
    assert.ok(markdown.includes(`_${labels.noCards}_`), locale);
    assert.ok(markdown.includes(`## ${labels.actionItems}`), locale);
    assert.ok(
      markdown.includes(`Обновить DoD<br>до пятницы — ${labels.assignee}: @Оля`),
      locale,
    );

    for (const userContent of [
      "# \\=Ретро &amp; &lt;команда&gt;",
      "Стабильный \"релиз\"<br>🚀",
      "\\=HYPERLINK\\(\"x\"\\)",
      "HTML &lt;script&gt;alert\\(1\\)&lt;/script&gt;",
      "Иван &amp; Ко",
      "Закрыть &lt;script&gt;",
    ]) {
      assert.ok(markdown.includes(userContent), `${locale}: ${userContent}`);
    }

    assert.equal(markdown.endsWith("\n"), true, locale);
    assert.equal(markdown.endsWith("\n\n"), false, locale);
    assert.equal(markdown.includes("<script>"), false, locale);
    assert.equal(markdown.includes("private-"), false, locale);
  }
});

test("Markdown uses English for an unsupported locale", () => {
  const markdown = serializeTargetMarkdownExport(exportData, "de-DE");

  assert.ok(markdown.includes("- Created:"));
  assert.ok(markdown.includes("## Action items"));
});

test("Markdown escaping normalizes internal line endings to generated safe breaks", () => {
  assert.equal(
    escapeTargetMarkdown("**bold**\r\n<script>\rnext"),
    "\\*\\*bold\\*\\*<br>&lt;script&gt;<br>next",
  );
});

import { isLocale, type Locale } from "../../i18n/locales.ts";
import {
  createTranslator,
  formatDate,
  formatNumber,
  type Translate,
} from "../../i18n/translate.ts";

export type ExportCard = {
  kind: "CARD";
  id: string;
  position: number;
  text: string;
  author: string | null;
  voteCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ExportGroup = {
  kind: "GROUP";
  id: string;
  position: number;
  title: string | null;
  primaryCardId: string;
  voteCount: number;
  cards: readonly ExportCard[];
  createdAt: string;
  updatedAt: string;
};

export type ExportActionItem = {
  id: string;
  text: string;
  assignee: string | null;
  completed: boolean;
  position: number;
  sourceCardId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardExportV2 = {
  schemaVersion: 2;
  exportedAt: string;
  board: {
    id: string;
    title: string;
    createdAt: string;
    expiresAt: string;
    settings: {
      cardsEnabled: boolean;
      votingEnabled: boolean;
      readOnly: boolean;
    };
  };
  columns: ReadonlyArray<{
    id: string;
    title: string;
    position: number;
    voteLimit: number;
    items: ReadonlyArray<ExportCard | ExportGroup>;
  }>;
  actionItems: readonly ExportActionItem[];
};

const projectExportCard = (card: ExportCard): ExportCard => ({
  kind: "CARD",
  id: card.id,
  position: card.position,
  text: card.text,
  author: card.author,
  voteCount: card.voteCount,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});

const compareIds = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const comparePositionAndId = (
  left: { position: number; id: string },
  right: { position: number; id: string },
): number => left.position - right.position || compareIds(left.id, right.id);

const compareExportItems = (
  left: ExportCard | ExportGroup,
  right: ExportCard | ExportGroup,
): number =>
  left.position - right.position ||
  (left.kind === right.kind
    ? compareIds(left.id, right.id)
    : left.kind === "CARD"
      ? -1
      : 1);

const projectExportGroup = (group: ExportGroup): ExportGroup => ({
  kind: "GROUP",
  id: group.id,
  position: group.position,
  title: group.title,
  primaryCardId: group.primaryCardId,
  voteCount: group.voteCount,
  cards: group.cards.map(projectExportCard).sort(comparePositionAndId),
  createdAt: group.createdAt,
  updatedAt: group.updatedAt,
});

export const projectTargetExport = (source: BoardExportV2): BoardExportV2 => ({
  schemaVersion: 2,
  exportedAt: source.exportedAt,
  board: {
    id: source.board.id,
    title: source.board.title,
    createdAt: source.board.createdAt,
    expiresAt: source.board.expiresAt,
    settings: {
      cardsEnabled: source.board.settings.cardsEnabled,
      votingEnabled: source.board.settings.votingEnabled,
      readOnly: source.board.settings.readOnly,
    },
  },
  columns: source.columns
    .map((column) => ({
      id: column.id,
      title: column.title,
      position: column.position,
      voteLimit: column.voteLimit,
      items: column.items
        .map((item) =>
          item.kind === "CARD" ? projectExportCard(item) : projectExportGroup(item),
        )
        .sort(compareExportItems),
    }))
    .sort(comparePositionAndId),
  actionItems: source.actionItems
    .map((actionItem) => ({
      id: actionItem.id,
      text: actionItem.text,
      assignee: actionItem.assignee,
      completed: actionItem.completed,
      position: actionItem.position,
      sourceCardId: actionItem.sourceCardId,
      createdAt: actionItem.createdAt,
      updatedAt: actionItem.updatedAt,
    }))
    .sort(comparePositionAndId),
});

export const serializeTargetJsonExport = (source: BoardExportV2): string =>
  JSON.stringify(projectTargetExport(source), null, 2);

export const TARGET_CSV_HEADER = [
  "recordType",
  "boardId",
  "boardTitle",
  "boardCreatedAt",
  "boardExpiresAt",
  "cardsEnabled",
  "votingEnabled",
  "readOnly",
  "columnId",
  "columnTitle",
  "columnPosition",
  "columnVoteLimit",
  "itemPosition",
  "itemId",
  "groupId",
  "groupTitle",
  "groupPrimaryCardId",
  "groupPosition",
  "cardId",
  "text",
  "author",
  "voteCount",
  "actionItemId",
  "assignee",
  "completed",
  "sourceCardId",
  "createdAt",
  "updatedAt",
] as const;

type CsvColumn = (typeof TARGET_CSV_HEADER)[number];
type CsvCell = string | number | boolean | null | undefined;
type CsvRow = Partial<Record<CsvColumn, CsvCell>>;

export const neutralizeTargetCsvFormula = (value: string): string => {
  if (/^[\u0000-\u001f]/.test(value) || /^[\u0000-\u0020]*[=+\-@]/.test(value)) {
    return `'${value}`;
  }

  return value;
};

const quoteCsvString = (value: string): string =>
  `"${neutralizeTargetCsvFormula(value).replaceAll('"', '""')}"`;

const serializeCsvCell = (value: CsvCell): string => {
  if (value === undefined) {
    return "";
  }
  if (value === null) {
    return '""';
  }
  if (typeof value === "string") {
    return quoteCsvString(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError("CSV integer fields must contain safe integers");
  }

  return value.toString();
};

const serializeCsvRow = (row: CsvRow): string =>
  TARGET_CSV_HEADER.map((column) => serializeCsvCell(row[column])).join(",");

const ungroupedCardRow = (
  boardId: string,
  column: BoardExportV2["columns"][number],
  card: ExportCard,
): CsvRow => ({
  recordType: "CARD",
  boardId,
  columnId: column.id,
  columnTitle: column.title,
  columnPosition: column.position,
  columnVoteLimit: column.voteLimit,
  itemPosition: card.position,
  itemId: card.id,
  cardId: card.id,
  text: card.text,
  author: card.author,
  voteCount: card.voteCount,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});

const groupedCardRow = (
  boardId: string,
  column: BoardExportV2["columns"][number],
  group: ExportGroup,
  card: ExportCard,
): CsvRow => ({
  recordType: "CARD",
  boardId,
  columnId: column.id,
  columnTitle: column.title,
  columnPosition: column.position,
  columnVoteLimit: column.voteLimit,
  itemPosition: group.position,
  itemId: group.id,
  groupId: group.id,
  groupTitle: group.title,
  groupPrimaryCardId: group.primaryCardId,
  groupPosition: card.position,
  cardId: card.id,
  text: card.text,
  author: card.author,
  voteCount: card.voteCount,
  createdAt: card.createdAt,
  updatedAt: card.updatedAt,
});

export const serializeTargetCsvExport = (source: BoardExportV2): string => {
  const data = projectTargetExport(source);
  const rows: CsvRow[] = [
    {
      recordType: "BOARD",
      boardId: data.board.id,
      boardTitle: data.board.title,
      boardCreatedAt: data.board.createdAt,
      boardExpiresAt: data.board.expiresAt,
      cardsEnabled: data.board.settings.cardsEnabled,
      votingEnabled: data.board.settings.votingEnabled,
      readOnly: data.board.settings.readOnly,
    },
  ];

  for (const column of data.columns) {
    rows.push({
      recordType: "COLUMN",
      boardId: data.board.id,
      columnId: column.id,
      columnTitle: column.title,
      columnPosition: column.position,
      columnVoteLimit: column.voteLimit,
    });

    for (const item of column.items) {
      if (item.kind === "CARD") {
        rows.push(ungroupedCardRow(data.board.id, column, item));
        continue;
      }

      for (const card of item.cards) {
        rows.push(groupedCardRow(data.board.id, column, item, card));
      }
    }
  }

  for (const actionItem of data.actionItems) {
    rows.push({
      recordType: "ACTION_ITEM",
      boardId: data.board.id,
      itemPosition: actionItem.position,
      itemId: actionItem.id,
      text: actionItem.text,
      actionItemId: actionItem.id,
      assignee: actionItem.assignee,
      completed: actionItem.completed,
      sourceCardId: actionItem.sourceCardId,
      createdAt: actionItem.createdAt,
      updatedAt: actionItem.updatedAt,
    });
  }

  const body = rows.map(serializeCsvRow);
  return `\uFEFF${[TARGET_CSV_HEADER.join(","), ...body].join("\n")}\n`;
};

const escapeMarkdownLine = (value: string): string => {
  const htmlEscaped = value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return htmlEscaped.replace(/([\\`*_[\]{}()#+\-.!|~=])/g, "\\$1");
};

export const escapeTargetMarkdown = (value: string): string =>
  value
    .split(/\r\n?|\n/)
    .map(escapeMarkdownLine)
    .join("<br>");

const renderMarkdownCard = (
  card: ExportCard,
  index: number,
  locale: Locale,
  t: Translate,
): string =>
  [
    `${index}. ${escapeTargetMarkdown(card.text)}`,
    `   - ${t("export.author")}: ${
      card.author === null ? "—" : escapeTargetMarkdown(card.author)
    }`,
    `   - ${t("export.votes")}: ${formatNumber(locale, card.voteCount)}`,
  ].join("\n");

const renderMarkdownGroup = (
  group: ExportGroup,
  index: number,
  locale: Locale,
  t: Translate,
): string => {
  const lines = [
    `${index}. ${t("export.group")}: ${
      group.title === null ? t("common.unnamed") : escapeTargetMarkdown(group.title)
    }`,
    `   - ${t("export.votes")}: ${formatNumber(locale, group.voteCount)}`,
  ];

  group.cards.forEach((card, cardIndex) => {
    const primarySuffix = card.id === group.primaryCardId
      ? ` — ${t("export.primary")}`
      : "";
    lines.push(
      `   ${cardIndex + 1}. ${escapeTargetMarkdown(card.text)}${primarySuffix}`,
      `      - ${t("export.author")}: ${
        card.author === null ? "—" : escapeTargetMarkdown(card.author)
      }`,
      `      - ${t("export.votes")}: ${formatNumber(locale, card.voteCount)}`,
    );
  });

  return lines.join("\n");
};

export const serializeTargetMarkdownExport = (
  source: BoardExportV2,
  locale: Locale = "en",
): string => {
  const data = projectTargetExport(source);
  const resolvedLocale = isLocale(locale) ? locale : "en";
  const t = createTranslator(resolvedLocale);
  const dateOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  } as const satisfies Intl.DateTimeFormatOptions;
  const sections = [
    `# ${escapeTargetMarkdown(data.board.title)}`,
    [
      `- ${t("export.createdAt")}: ${formatDate(resolvedLocale, data.board.createdAt, dateOptions)}`,
      `- ${t("export.expiresAt")}: ${formatDate(resolvedLocale, data.board.expiresAt, dateOptions)}`,
      `- ${t("export.cards")}: ${
        t(data.board.settings.cardsEnabled ? "common.yes" : "common.no")
      }`,
      `- ${t("export.voting")}: ${
        t(data.board.settings.votingEnabled ? "common.yes" : "common.no")
      }`,
      `- ${t("export.readOnly")}: ${
        t(data.board.settings.readOnly ? "common.yes" : "common.no")
      }`,
    ].join("\n"),
  ];

  for (const column of data.columns) {
    const content =
      column.items.length === 0
        ? `_${t("export.noCards")}_`
        : column.items
            .map((item, index) =>
              item.kind === "CARD"
                ? renderMarkdownCard(item, index + 1, resolvedLocale, t)
                : renderMarkdownGroup(item, index + 1, resolvedLocale, t),
            )
            .join("\n");

    sections.push(
      `## ${t("export.columnHeading", {
        title: escapeTargetMarkdown(column.title),
        count: formatNumber(resolvedLocale, column.voteLimit),
      })}\n\n${content}`,
    );
  }

  const actionContent =
    data.actionItems.length === 0
      ? `_${t("export.noActionItems")}_`
      : data.actionItems
          .map(
            (actionItem) =>
              `- [${actionItem.completed ? "x" : " "}] ${escapeTargetMarkdown(
                actionItem.text,
              )} — ${t("export.assignee")}: ${
                actionItem.assignee === null
                  ? "—"
                  : escapeTargetMarkdown(actionItem.assignee)
              }`,
          )
          .join("\n");
  sections.push(`## ${t("export.actionItems")}\n\n${actionContent}`);

  return `${sections.join("\n\n")}\n`;
};

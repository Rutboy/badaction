import { COLUMN_LABELS, type ColumnType } from "../constants/columns.ts";

type Row = {
  cardId: string;
  boardId: string;
  column: ColumnType;
  text: string;
  likesCount: number;
  owner: string | null;
  createdAt: string;
};

export const neutralizeSpreadsheetFormula = (value: string) => {
  if (/^[\t\r\n]/.test(value) || /^[\t\r\n ]*[=+\-@]/.test(value)) {
    return `'${value}`;
  }

  return value;
};

const quote = (value: string) =>
  `"${neutralizeSpreadsheetFormula(value).replaceAll('"', '""')}"`;

export const toCsv = (rows: Row[]) => {
  const header = [
    "cardId",
    "boardId",
    "column",
    "columnLabel",
    "text",
    "likesCount",
    "owner",
    "createdAt",
  ].join(",");

  const body = rows
    .map((row) =>
      [
        quote(row.cardId),
        quote(row.boardId),
        quote(row.column),
        quote(COLUMN_LABELS[row.column]),
        quote(row.text),
        row.likesCount.toString(),
        quote(row.owner ?? ""),
        quote(row.createdAt),
      ].join(","),
    )
    .join("\n");

  return `\uFEFF${header}\n${body}`;
};

export const COLUMNS = [
  { key: "WENT_WELL", label: "Уже хорошо" },
  { key: "TO_IMPROVE", label: "Следует улучшить" },
  { key: "ACTIONS", label: "Решения" },
] as const;

export const LIKEABLE_COLUMNS = ["WENT_WELL", "TO_IMPROVE"] as const;

export type ColumnType = (typeof COLUMNS)[number]["key"];
export type VoteColumnType = (typeof LIKEABLE_COLUMNS)[number];

export const COLUMN_LABELS: Record<ColumnType, string> = Object.fromEntries(
  COLUMNS.map((column) => [column.key, column.label]),
) as Record<ColumnType, string>;

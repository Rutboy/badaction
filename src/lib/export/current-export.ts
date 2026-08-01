import type { ColumnType } from "../constants/columns.ts";

export type CurrentExportRow = {
  cardId: string;
  boardId: string;
  column: ColumnType;
  columnLabel: string;
  text: string;
  likesCount: number;
  owner: string | null;
  createdAt: string;
};

export const serializeCurrentJsonExport = ({
  boardId,
  exportedAt,
  cards,
}: {
  boardId: string;
  exportedAt: Date;
  cards: readonly CurrentExportRow[];
}) => JSON.stringify(
  {
    boardId,
    exportedAt: exportedAt.toISOString(),
    cards: cards.map((card) => ({
      cardId: card.cardId,
      boardId: card.boardId,
      column: card.column,
      columnLabel: card.columnLabel,
      text: card.text,
      likesCount: card.likesCount,
      owner: card.owner,
      createdAt: card.createdAt,
    })),
  },
  null,
  2,
);

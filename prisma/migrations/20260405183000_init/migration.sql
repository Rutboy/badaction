-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ColumnType" AS ENUM ('WENT_WELL', 'TO_IMPROVE', 'ACTIONS');

-- CreateEnum
CREATE TYPE "VoteColumnType" AS ENUM ('WENT_WELL', 'TO_IMPROVE');

-- CreateTable
CREATE TABLE "boards" (
    "id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "column" "ColumnType" NOT NULL,
    "text" TEXT NOT NULL,
    "owner" TEXT,
    "likes_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "votes" (
    "id" TEXT NOT NULL,
    "board_id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "column" "VoteColumnType" NOT NULL,
    "visitor_token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cards_board_id_column_created_at_idx" ON "cards"("board_id", "column", "created_at" DESC);

-- CreateIndex
CREATE INDEX "cards_board_id_idx" ON "cards"("board_id");

-- CreateIndex
CREATE INDEX "votes_board_id_column_visitor_token_idx" ON "votes"("board_id", "column", "visitor_token");

-- CreateIndex
CREATE INDEX "votes_card_id_idx" ON "votes"("card_id");

-- CreateIndex
CREATE UNIQUE INDEX "votes_card_id_visitor_token_key" ON "votes"("card_id", "visitor_token");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "votes" ADD CONSTRAINT "votes_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

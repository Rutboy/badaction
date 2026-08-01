ALTER TABLE "votes" DROP CONSTRAINT "votes_card_id_fkey";
ALTER TABLE "cards" DROP CONSTRAINT "cards_board_id_fkey";

ALTER TABLE "boards"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid;

ALTER TABLE "cards"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "board_id" TYPE UUID USING "board_id"::uuid;

ALTER TABLE "votes"
  ALTER COLUMN "id" TYPE UUID USING "id"::uuid,
  ALTER COLUMN "board_id" TYPE UUID USING "board_id"::uuid,
  ALTER COLUMN "card_id" TYPE UUID USING "card_id"::uuid;

ALTER TABLE "cards"
  ADD CONSTRAINT "cards_text_trimmed_length_check"
    CHECK (length(btrim("text")) BETWEEN 1 AND 1000),
  ADD CONSTRAINT "cards_owner_by_column_check"
    CHECK (
      ("column" = 'ACTIONS' AND "owner" IS NOT NULL AND length(btrim("owner")) BETWEEN 1 AND 120)
      OR
      ("column" IN ('WENT_WELL', 'TO_IMPROVE') AND "owner" IS NULL)
    );

ALTER TABLE "cards"
  ADD CONSTRAINT "cards_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "votes"
  ADD CONSTRAINT "votes_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "votes_card_id_fkey"
    FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

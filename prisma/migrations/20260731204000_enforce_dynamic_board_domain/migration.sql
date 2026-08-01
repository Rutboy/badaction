BEGIN;

LOCK TABLE
  "boards",
  "board_columns",
  "cards",
  "card_groups",
  "votes",
  "action_items",
  "board_memberships"
IN SHARE ROW EXCLUSIVE MODE;

DO $target_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "boards"
    WHERE "title" IS NULL
       OR length(btrim("title")) NOT BETWEEN 1 AND 120
       OR "cards_enabled" IS NULL
       OR "voting_enabled" IS NULL
       OR "read_only" IS NULL
       OR "revision" IS NULL
       OR "revision" < 0
  ) THEN
    RAISE EXCEPTION 'Cannot enforce target boards: invalid or NULL target fields exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "boards" AS board
    WHERE (
      SELECT COUNT(*)
      FROM "board_columns" AS board_column
      WHERE board_column."board_id" = board."id"
    ) <> 2
  ) THEN
    RAISE EXCEPTION 'Cannot enforce target board columns: backfilled board does not have two columns';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "cards" AS card
    LEFT JOIN "board_columns" AS board_column
      ON board_column."id" = card."column_id"
     AND board_column."board_id" = card."board_id"
    LEFT JOIN "board_memberships" AS membership
      ON membership."id" = card."created_by_membership_id"
     AND membership."board_id" = card."board_id"
    WHERE card."column_id" IS NULL
       OR card."position" IS NULL
       OR card."updated_at" IS NULL
       OR card."updated_at" < card."created_at"
       OR board_column."id" IS NULL
       OR (
         card."created_by_membership_id" IS NOT NULL
         AND membership."id" IS NULL
       )
       OR ((card."group_id" IS NULL) <> (card."group_position" IS NULL))
  ) THEN
    RAISE EXCEPTION 'Cannot enforce target cards: invalid or orphan target fields exist';
  END IF;

  IF EXISTS (SELECT 1 FROM "cards" WHERE "column" = 'ACTIONS') THEN
    RAISE EXCEPTION 'Cannot enforce target cards: legacy ACTIONS rows remain';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "card_groups" AS card_group
    LEFT JOIN "board_columns" AS board_column
      ON board_column."id" = card_group."column_id"
     AND board_column."board_id" = card_group."board_id"
    LEFT JOIN "cards" AS primary_card
      ON primary_card."id" = card_group."primary_card_id"
     AND primary_card."board_id" = card_group."board_id"
     AND primary_card."column_id" = card_group."column_id"
    WHERE board_column."id" IS NULL OR primary_card."id" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "cards" AS card
    LEFT JOIN "card_groups" AS card_group
      ON card_group."id" = card."group_id"
     AND card_group."board_id" = card."board_id"
     AND card_group."column_id" = card."column_id"
    WHERE card."group_id" IS NOT NULL AND card_group."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot enforce target groups: orphan or cross-column rows exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "votes" AS vote
    LEFT JOIN "cards" AS card
      ON card."id" = vote."card_id"
     AND card."board_id" = vote."board_id"
     AND card."column_id" = vote."column_id"
    LEFT JOIN "board_columns" AS board_column
      ON board_column."id" = vote."column_id"
     AND board_column."board_id" = vote."board_id"
    WHERE vote."column_id" IS NULL
       OR card."id" IS NULL
       OR board_column."id" IS NULL
       OR vote."quota_slot" NOT BETWEEN 1 AND 20
  ) THEN
    RAISE EXCEPTION 'Cannot enforce target votes: invalid or orphan target fields exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "action_items" AS action_item
    LEFT JOIN "boards" AS board ON board."id" = action_item."board_id"
    LEFT JOIN "cards" AS source_card
      ON source_card."id" = action_item."source_card_id"
     AND source_card."board_id" = action_item."board_id"
    WHERE board."id" IS NULL
       OR (
         action_item."source_card_id" IS NOT NULL
         AND source_card."id" IS NULL
       )
  ) THEN
    RAISE EXCEPTION 'Cannot enforce target action items: orphan or cross-board rows exist';
  END IF;
END
$target_preflight$;

ALTER TABLE "boards"
  ALTER COLUMN "title" SET NOT NULL,
  ALTER COLUMN "cards_enabled" SET DEFAULT true,
  ALTER COLUMN "cards_enabled" SET NOT NULL,
  ALTER COLUMN "voting_enabled" SET DEFAULT true,
  ALTER COLUMN "voting_enabled" SET NOT NULL,
  ALTER COLUMN "read_only" SET DEFAULT false,
  ALTER COLUMN "read_only" SET NOT NULL,
  ALTER COLUMN "revision" SET DEFAULT 0,
  ALTER COLUMN "revision" SET NOT NULL,
  ADD CONSTRAINT "boards_title_trimmed_length_check"
    CHECK (length(btrim("title")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "boards_revision_nonnegative_check"
    CHECK ("revision" >= 0);

-- These fixed-enum constraints cannot describe target dynamic columns. The
-- legacy columns and compatible indexes remain until the later contract drop.
ALTER TABLE "votes"
  DROP CONSTRAINT "votes_card_id_board_id_column_fkey",
  DROP CONSTRAINT "votes_likeable_column_check";

DROP INDEX "votes_board_id_column_visitor_token_quota_slot_key";

ALTER TABLE "cards"
  DROP CONSTRAINT "cards_owner_by_column_check",
  ALTER COLUMN "column" DROP NOT NULL,
  ALTER COLUMN "column_id" SET NOT NULL,
  ALTER COLUMN "position" SET NOT NULL,
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "updated_at" SET NOT NULL,
  ADD CONSTRAINT "cards_author_trimmed_length_check"
    CHECK ("author" IS NULL OR length(btrim("author")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "cards_group_pair_check"
    CHECK (("group_id" IS NULL) = ("group_position" IS NULL)),
  ADD CONSTRAINT "cards_updated_after_created_check"
    CHECK ("updated_at" >= "created_at");

ALTER TABLE "votes"
  ALTER COLUMN "column" DROP NOT NULL,
  ALTER COLUMN "column_id" SET NOT NULL;

ALTER TABLE "cards"
  ADD CONSTRAINT "cards_column_id_board_id_fkey"
    FOREIGN KEY ("column_id", "board_id")
    REFERENCES "board_columns"("id", "board_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "cards_created_by_membership_id_board_id_fkey"
    FOREIGN KEY ("created_by_membership_id", "board_id")
    REFERENCES "board_memberships"("id", "board_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "cards_group_id_board_id_column_id_fkey"
    FOREIGN KEY ("group_id", "board_id", "column_id")
    REFERENCES "card_groups"("id", "board_id", "column_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "card_groups"
  ADD CONSTRAINT "card_groups_column_id_board_id_fkey"
    FOREIGN KEY ("column_id", "board_id")
    REFERENCES "board_columns"("id", "board_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "card_groups_primary_card_id_board_id_column_id_fkey"
    FOREIGN KEY ("primary_card_id", "board_id", "column_id")
    REFERENCES "cards"("id", "board_id", "column_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
    DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "votes"
  ADD CONSTRAINT "votes_card_id_board_id_column_id_fkey"
    FOREIGN KEY ("card_id", "board_id", "column_id")
    REFERENCES "cards"("id", "board_id", "column_id")
    ON DELETE CASCADE ON UPDATE NO ACTION
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT "votes_column_id_board_id_fkey"
    FOREIGN KEY ("column_id", "board_id")
    REFERENCES "board_columns"("id", "board_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  ADD CONSTRAINT "votes_board_id_column_id_visitor_token_quota_slot_key"
    UNIQUE ("board_id", "column_id", "visitor_token", "quota_slot")
    DEFERRABLE INITIALLY IMMEDIATE;

-- PostgreSQL 16 column-list SET NULL preserves the required board_id while
-- clearing only the optional source locator.
ALTER TABLE "action_items"
  ADD CONSTRAINT "action_items_source_card_id_board_id_fkey"
    FOREIGN KEY ("source_card_id", "board_id")
    REFERENCES "cards"("id", "board_id")
    ON DELETE SET NULL ("source_card_id") ON UPDATE NO ACTION;

COMMIT;

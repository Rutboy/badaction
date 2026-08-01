BEGIN;

-- This phase remains compatible with the frozen writer. Existing rows receive
-- only nullable target columns; defaults and NOT NULL enforcement are added
-- after the maintenance-window backfill.
ALTER TABLE "boards"
  ADD COLUMN "title" VARCHAR(120),
  ADD COLUMN "cards_enabled" BOOLEAN,
  ADD COLUMN "voting_enabled" BOOLEAN,
  ADD COLUMN "read_only" BOOLEAN,
  ADD COLUMN "revision" BIGINT;

CREATE TABLE "board_columns" (
  "id" UUID NOT NULL,
  "board_id" UUID NOT NULL,
  "title" VARCHAR(80) NOT NULL,
  "position" INTEGER NOT NULL,
  "vote_limit" SMALLINT NOT NULL DEFAULT 3,

  CONSTRAINT "board_columns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_columns_id_board_id_key" UNIQUE ("id", "board_id"),
  CONSTRAINT "board_columns_title_trimmed_length_check"
    CHECK (length(btrim("title")) BETWEEN 1 AND 80),
  CONSTRAINT "board_columns_vote_limit_check"
    CHECK ("vote_limit" BETWEEN 0 AND 20),
  CONSTRAINT "board_columns_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE
);

CREATE INDEX "board_columns_board_id_position_id_idx"
  ON "board_columns"("board_id", "position", "id");

ALTER TABLE "cards"
  ADD COLUMN "column_id" UUID,
  ADD COLUMN "author" VARCHAR(120),
  ADD COLUMN "created_by_membership_id" UUID,
  ADD COLUMN "position" INTEGER,
  ADD COLUMN "group_id" UUID,
  ADD COLUMN "group_position" INTEGER,
  ADD COLUMN "updated_at" TIMESTAMPTZ(3),
  ADD CONSTRAINT "cards_id_board_id_key" UNIQUE ("id", "board_id"),
  ADD CONSTRAINT "cards_id_board_id_column_id_key"
    UNIQUE ("id", "board_id", "column_id");

CREATE INDEX "cards_board_id_column_id_position_id_ungrouped_idx"
  ON "cards"("board_id", "column_id", "position", "id")
  WHERE "group_id" IS NULL;

CREATE INDEX "cards_group_id_group_position_id_idx"
  ON "cards"("group_id", "group_position", "id");

CREATE INDEX "cards_created_by_membership_id_idx"
  ON "cards"("created_by_membership_id");

ALTER TABLE "board_memberships"
  ADD CONSTRAINT "board_memberships_id_board_id_key"
    UNIQUE ("id", "board_id");

CREATE TABLE "card_groups" (
  "id" UUID NOT NULL,
  "board_id" UUID NOT NULL,
  "column_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "primary_card_id" UUID NOT NULL,
  "title" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "card_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "card_groups_id_board_id_column_id_key"
    UNIQUE ("id", "board_id", "column_id"),
  CONSTRAINT "card_groups_title_trimmed_length_check"
    CHECK ("title" IS NULL OR length(btrim("title")) BETWEEN 1 AND 120),
  CONSTRAINT "card_groups_updated_after_created_check"
    CHECK ("updated_at" >= "created_at"),
  CONSTRAINT "card_groups_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE
);

CREATE INDEX "card_groups_board_id_column_id_position_id_idx"
  ON "card_groups"("board_id", "column_id", "position", "id");

CREATE TABLE "action_items" (
  "id" UUID NOT NULL,
  "board_id" UUID NOT NULL,
  "text" TEXT NOT NULL,
  "assignee" VARCHAR(120),
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "position" INTEGER NOT NULL,
  "source_card_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "action_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "action_items_text_trimmed_length_check"
    CHECK (length(btrim("text")) BETWEEN 1 AND 1000),
  CONSTRAINT "action_items_assignee_trimmed_length_check"
    CHECK ("assignee" IS NULL OR length(btrim("assignee")) BETWEEN 1 AND 120),
  CONSTRAINT "action_items_updated_after_created_check"
    CHECK ("updated_at" >= "created_at"),
  CONSTRAINT "action_items_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE
);

CREATE INDEX "action_items_board_id_position_id_idx"
  ON "action_items"("board_id", "position", "id");

CREATE INDEX "action_items_source_card_id_idx"
  ON "action_items"("source_card_id");

-- The database range must be widened before target writers can use per-column
-- limits above three. Historical slot values themselves are not rewritten.
ALTER TABLE "votes"
  DROP CONSTRAINT "votes_quota_slot_check",
  ALTER COLUMN "quota_slot" TYPE SMALLINT USING "quota_slot"::SMALLINT,
  ADD COLUMN "column_id" UUID,
  ADD CONSTRAINT "votes_quota_slot_check"
    CHECK ("quota_slot" BETWEEN 1 AND 20);

CREATE INDEX "votes_board_id_column_id_idx"
  ON "votes"("board_id", "column_id");

COMMIT;

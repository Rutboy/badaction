BEGIN;

-- Existing timestamp values were written as UTC by the application. Preserve
-- those instants explicitly instead of interpreting them in the database
-- session timezone during the type conversion.
ALTER TABLE "boards"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3)
    USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "cards"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3)
    USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "votes"
  ALTER COLUMN "created_at" DROP DEFAULT,
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3)
    USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Existing boards receive a fresh retention window so deploying this migration
-- does not make old links disappear immediately.
ALTER TABLE "boards" ADD COLUMN "expires_at" TIMESTAMPTZ(3);

UPDATE "boards"
SET "expires_at" = CURRENT_TIMESTAMP + INTERVAL '90 days';

ALTER TABLE "boards"
  ALTER COLUMN "expires_at" SET NOT NULL,
  ALTER COLUMN "expires_at" SET DEFAULT (CURRENT_TIMESTAMP + INTERVAL '90 days'),
  ADD CONSTRAINT "boards_expiry_after_creation_check"
    CHECK ("expires_at" > "created_at");

CREATE INDEX "boards_expires_at_idx" ON "boards"("expires_at");

-- A vote connected to ACTIONS cannot be represented by the hardened schema.
-- Stop with a diagnostic instead of silently deleting such data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "votes" AS vote
    JOIN "cards" AS card ON card."id" = vote."card_id"
    WHERE card."column" = 'ACTIONS'
  ) THEN
    RAISE EXCEPTION
      'Cannot harden votes: at least one vote references an ACTIONS card'
      USING HINT = 'Remove or repair invalid ACTIONS votes before retrying the migration.';
  END IF;
END
$$;

-- card_id is the canonical identity. Repair any legacy redundant values before
-- replacing the independent foreign keys with one composite identity.
UPDATE "votes" AS vote
SET
  "board_id" = card."board_id",
  "column" = card."column"::text::"VoteColumnType"
FROM "cards" AS card
WHERE vote."card_id" = card."id"
  AND (
    vote."board_id" IS DISTINCT FROM card."board_id"
    OR vote."column"::text IS DISTINCT FROM card."column"::text
  );

ALTER TABLE "votes"
  DROP CONSTRAINT "votes_board_id_fkey",
  DROP CONSTRAINT "votes_card_id_fkey";

ALTER TABLE "cards"
  ADD CONSTRAINT "cards_vote_identity_key"
    UNIQUE ("id", "board_id", "column");

ALTER TABLE "votes"
  ALTER COLUMN "column" TYPE "ColumnType"
    USING "column"::text::"ColumnType",
  ADD CONSTRAINT "votes_likeable_column_check"
    CHECK ("column" IN ('WENT_WELL', 'TO_IMPROVE')),
  ADD CONSTRAINT "votes_card_id_board_id_column_fkey"
    FOREIGN KEY ("card_id", "board_id", "column")
    REFERENCES "cards"("id", "board_id", "column")
    ON DELETE CASCADE ON UPDATE CASCADE;

DROP TYPE "VoteColumnType";

-- Vote rows are authoritative. API counts are derived from them, eliminating
-- the possibility of a stale denormalized counter.
ALTER TABLE "cards" DROP COLUMN "likes_count";

CREATE TABLE "rate_limit_buckets" (
  "key" VARCHAR(64) NOT NULL,
  "count" INTEGER NOT NULL,
  "reset_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "rate_limit_buckets_count_check" CHECK ("count" >= 1)
);

CREATE INDEX "rate_limit_buckets_reset_at_idx"
  ON "rate_limit_buckets"("reset_at");

COMMIT;

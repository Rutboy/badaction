BEGIN;

-- Keep this nullable only while existing rows are checked and backfilled. The
-- transaction holds the table lock until COMMIT, so concurrent writes cannot
-- slip between the preflight and the final constraints.
ALTER TABLE "votes" ADD COLUMN "quota_slot" INTEGER;

-- A deterministic 1..3 slot cannot be assigned without deleting data when a
-- legacy visitor already has more than three votes in one board column. Stop
-- and require an explicit data decision instead of silently discarding votes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "votes"
    GROUP BY "board_id", "column", "visitor_token"
    HAVING COUNT(*) > 3
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce vote quota slots: at least one visitor has more than three votes in a board column'
      USING HINT = 'Inspect and repair over-quota vote groups before retrying the migration.';
  END IF;
END
$$;

WITH ranked_votes AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "board_id", "column", "visitor_token"
      ORDER BY "created_at", "id"
    )::INTEGER AS "quota_slot"
  FROM "votes"
)
UPDATE "votes" AS vote
SET "quota_slot" = ranked_vote."quota_slot"
FROM ranked_votes AS ranked_vote
WHERE vote."id" = ranked_vote."id";

ALTER TABLE "votes"
  ALTER COLUMN "quota_slot" SET NOT NULL,
  ADD CONSTRAINT "votes_quota_slot_check"
    CHECK ("quota_slot" BETWEEN 1 AND 3);

DROP INDEX "votes_board_id_column_visitor_token_idx";

CREATE UNIQUE INDEX "votes_board_id_column_visitor_token_quota_slot_key"
  ON "votes"("board_id", "column", "visitor_token", "quota_slot");

COMMIT;

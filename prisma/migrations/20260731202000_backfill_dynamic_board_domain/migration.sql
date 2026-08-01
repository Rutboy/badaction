BEGIN;

-- The runbook requires all old writers to be stopped before this phase. Hold
-- explicit write-conflicting locks so a mistakenly restarted writer cannot
-- create an unbackfilled row during the migration.
LOCK TABLE
  "boards",
  "cards",
  "votes",
  "board_columns",
  "card_groups",
  "action_items"
IN SHARE ROW EXCLUSIVE MODE;

DO $backfill_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "board_columns")
    OR EXISTS (SELECT 1 FROM "card_groups")
    OR EXISTS (SELECT 1 FROM "action_items")
  THEN
    RAISE EXCEPTION
      'Cannot backfill target board domain: target tables already contain rows'
      USING HINT = 'Stop target writers and investigate the partial rollout before retrying.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "boards"
    WHERE "title" IS NOT NULL
       OR "cards_enabled" IS NOT NULL
       OR "voting_enabled" IS NOT NULL
       OR "read_only" IS NOT NULL
       OR "revision" IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM "cards"
    WHERE "column_id" IS NOT NULL
       OR "author" IS NOT NULL
       OR "created_by_membership_id" IS NOT NULL
       OR "position" IS NOT NULL
       OR "group_id" IS NOT NULL
       OR "group_position" IS NOT NULL
       OR "updated_at" IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM "votes"
    WHERE "column_id" IS NOT NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill target board domain: target columns were written before backfill';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "votes" AS vote
    LEFT JOIN "cards" AS card ON card."id" = vote."card_id"
    WHERE card."id" IS NULL
       OR vote."board_id" IS DISTINCT FROM card."board_id"
       OR vote."column" IS DISTINCT FROM card."column"
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill target board domain: a legacy vote does not match its card';
  END IF;

  IF EXISTS (SELECT 1 FROM "votes" WHERE "column" = 'ACTIONS') THEN
    RAISE EXCEPTION
      'Cannot backfill target board domain: a legacy ACTIONS vote exists';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "votes"
    WHERE "quota_slot" NOT BETWEEN 1 AND 3
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill target board domain: baseline vote slots exceed 1..3'
      USING HINT = 'Target writers must not run before backfill and enforcement finish.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "cards"
    GROUP BY "board_id", "column"
    HAVING COUNT(*) > (2147483647 / 1024)
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill target board domain: ordered item count exceeds INTEGER position capacity';
  END IF;
END
$backfill_preflight$;

UPDATE "boards"
SET
  "title" = 'Ретроспектива ' || lower(substr("id"::text, 1, 8)),
  "cards_enabled" = true,
  "voting_enabled" = true,
  "read_only" = false,
  "revision" = 0;

INSERT INTO "board_columns" (
  "id",
  "board_id",
  "title",
  "position",
  "vote_limit"
)
SELECT
  gen_random_uuid(),
  board."id",
  definition."title",
  definition."position",
  3
FROM "boards" AS board
CROSS JOIN (
  VALUES
    ('Уже хорошо'::VARCHAR(80), 1024),
    ('Следует улучшить'::VARCHAR(80), 2048)
) AS definition("title", "position");

WITH ranked_feedback AS (
  SELECT
    card."id",
    card."board_id",
    card."column",
    (
      ROW_NUMBER() OVER (
        PARTITION BY card."board_id", card."column"
        ORDER BY card."created_at" DESC, card."id" DESC
      ) * 1024
    )::INTEGER AS "position"
  FROM "cards" AS card
  WHERE card."column" IN ('WENT_WELL', 'TO_IMPROVE')
)
UPDATE "cards" AS card
SET
  "column_id" = board_column."id",
  "author" = NULL,
  "created_by_membership_id" = NULL,
  "position" = ranked_feedback."position",
  "updated_at" = card."created_at"
FROM ranked_feedback
INNER JOIN "board_columns" AS board_column
  ON board_column."board_id" = ranked_feedback."board_id"
 AND board_column."position" = CASE ranked_feedback."column"
   WHEN 'WENT_WELL' THEN 1024
   WHEN 'TO_IMPROVE' THEN 2048
 END
WHERE card."id" = ranked_feedback."id";

UPDATE "votes" AS vote
SET "column_id" = card."column_id"
FROM "cards" AS card
WHERE card."id" = vote."card_id";

DO $backfill_verification$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "boards"
    WHERE "title" IS NULL
       OR "title" IS DISTINCT FROM (
         'Ретроспектива ' || lower(substr("id"::text, 1, 8))
       )
       OR "cards_enabled" IS DISTINCT FROM true
       OR "voting_enabled" IS DISTINCT FROM true
       OR "read_only" IS DISTINCT FROM false
       OR "revision" IS DISTINCT FROM 0
  ) THEN
    RAISE EXCEPTION 'Target board metadata backfill verification failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "boards" AS board
    WHERE (
      SELECT COUNT(*)
      FROM "board_columns" AS board_column
      WHERE board_column."board_id" = board."id"
    ) <> 2
       OR (
         SELECT COUNT(*)
         FROM "board_columns" AS board_column
         WHERE board_column."board_id" = board."id"
           AND board_column."title" = 'Уже хорошо'
           AND board_column."position" = 1024
           AND board_column."vote_limit" = 3
       ) <> 1
       OR (
         SELECT COUNT(*)
         FROM "board_columns" AS board_column
         WHERE board_column."board_id" = board."id"
           AND board_column."title" = 'Следует улучшить'
           AND board_column."position" = 2048
           AND board_column."vote_limit" = 3
       ) <> 1
  ) THEN
    RAISE EXCEPTION 'Default board column backfill verification failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "cards" AS card
    LEFT JOIN "board_columns" AS board_column
      ON board_column."id" = card."column_id"
     AND board_column."board_id" = card."board_id"
    WHERE card."column" IN ('WENT_WELL', 'TO_IMPROVE')
      AND (
        board_column."id" IS NULL
        OR card."position" IS NULL
        OR card."author" IS NOT NULL
        OR card."created_by_membership_id" IS NOT NULL
        OR card."updated_at" IS DISTINCT FROM card."created_at"
        OR board_column."position" IS DISTINCT FROM CASE card."column"
          WHEN 'WENT_WELL' THEN 1024
          WHEN 'TO_IMPROVE' THEN 2048
        END
      )
  ) THEN
    RAISE EXCEPTION 'Feedback card backfill verification failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "votes" AS vote
    LEFT JOIN "cards" AS card
      ON card."id" = vote."card_id"
     AND card."board_id" = vote."board_id"
    WHERE card."id" IS NULL
       OR vote."column_id" IS NULL
       OR vote."column_id" IS DISTINCT FROM card."column_id"
  ) THEN
    RAISE EXCEPTION 'Vote column backfill verification failed';
  END IF;
END
$backfill_verification$;

COMMIT;

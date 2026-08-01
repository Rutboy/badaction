BEGIN;

LOCK TABLE "cards", "votes", "action_items" IN SHARE ROW EXCLUSIVE MODE;

DO $actions_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM "action_items") THEN
    RAISE EXCEPTION
      'Cannot migrate ACTIONS cards: action_items already contains rows'
      USING HINT = 'Stop target writers and investigate the partial rollout before retrying.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "votes" AS vote
    INNER JOIN "cards" AS card ON card."id" = vote."card_id"
    WHERE card."column" = 'ACTIONS'
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate ACTIONS cards: an ACTIONS card has votes';
  END IF;
END
$actions_preflight$;

WITH ranked_actions AS (
  SELECT
    card."id",
    (
      ROW_NUMBER() OVER (
        PARTITION BY card."board_id"
        ORDER BY card."created_at" DESC, card."id" DESC
      ) * 1024
    )::INTEGER AS "position"
  FROM "cards" AS card
  WHERE card."column" = 'ACTIONS'
)
INSERT INTO "action_items" (
  "id",
  "board_id",
  "text",
  "assignee",
  "completed",
  "position",
  "source_card_id",
  "created_at",
  "updated_at"
)
SELECT
  card."id",
  card."board_id",
  card."text",
  card."owner",
  false,
  ranked_actions."position",
  NULL,
  card."created_at",
  card."created_at"
FROM "cards" AS card
INNER JOIN ranked_actions ON ranked_actions."id" = card."id";

DO $actions_verification$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM "action_items"
  ) IS DISTINCT FROM (
    SELECT COUNT(*)
    FROM "cards"
    WHERE "column" = 'ACTIONS'
  ) THEN
    RAISE EXCEPTION 'ACTIONS migration changed the source row count';
  END IF;

  IF EXISTS (
    SELECT card."id"
    FROM "cards" AS card
    WHERE card."column" = 'ACTIONS'
    EXCEPT
    SELECT action_item."id"
    FROM "action_items" AS action_item
  ) OR EXISTS (
    SELECT action_item."id"
    FROM "action_items" AS action_item
    EXCEPT
    SELECT card."id"
    FROM "cards" AS card
    WHERE card."column" = 'ACTIONS'
  ) THEN
    RAISE EXCEPTION 'ACTIONS migration did not preserve source UUIDs';
  END IF;

  IF EXISTS (
    WITH ranked_actions AS (
      SELECT
        card."id",
        (
          ROW_NUMBER() OVER (
            PARTITION BY card."board_id"
            ORDER BY card."created_at" DESC, card."id" DESC
          ) * 1024
        )::INTEGER AS "position"
      FROM "cards" AS card
      WHERE card."column" = 'ACTIONS'
    )
    SELECT 1
    FROM "cards" AS card
    INNER JOIN ranked_actions ON ranked_actions."id" = card."id"
    INNER JOIN "action_items" AS action_item ON action_item."id" = card."id"
    WHERE action_item."board_id" IS DISTINCT FROM card."board_id"
       OR action_item."text" IS DISTINCT FROM card."text"
       OR action_item."assignee" IS DISTINCT FROM card."owner"
       OR action_item."completed" IS DISTINCT FROM false
       OR action_item."position" IS DISTINCT FROM ranked_actions."position"
       OR action_item."source_card_id" IS NOT NULL
       OR action_item."created_at" IS DISTINCT FROM card."created_at"
       OR action_item."updated_at" IS DISTINCT FROM card."created_at"
  ) THEN
    RAISE EXCEPTION 'ACTIONS migration changed source values or ordering';
  END IF;
END
$actions_verification$;

DELETE FROM "cards" WHERE "column" = 'ACTIONS';

DO $actions_delete_verification$
BEGIN
  IF EXISTS (SELECT 1 FROM "cards" WHERE "column" = 'ACTIONS') THEN
    RAISE EXCEPTION 'ACTIONS source rows remained after verified copy';
  END IF;
END
$actions_delete_verification$;

COMMIT;

DO $$
DECLARE
  has_target_schema BOOLEAN := to_regclass('board_columns') IS NOT NULL;
BEGIN
  IF (SELECT COUNT(*) FROM "boards") <> 2
    OR (SELECT COUNT(*) FROM "votes") <> 5
    OR (SELECT COUNT(*) FROM "anonymous_sessions") <> 3
    OR (SELECT COUNT(*) FROM "board_memberships") <> 3
    OR (SELECT COUNT(*) FROM "board_invitations") <> 4
    OR (SELECT COUNT(*) FROM "invitation_redemptions") <> 2
    OR (SELECT COUNT(*) FROM "rate_limit_buckets") <> 1
  THEN
    RAISE EXCEPTION 'Upgrade changed preserved Stage 0 row counts';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "boards"
    WHERE "id" = '11111111-1111-4111-8111-111111111111'
      AND "created_at" = '2026-01-01T00:00:00.000Z'
      AND "expires_at" = '2099-01-01T00:00:00.000Z'
  ) OR NOT EXISTS (
    SELECT 1
    FROM "boards"
    WHERE "id" = '22222222-2222-4222-8222-222222222222'
      AND "created_at" = '2026-02-01T00:00:00.000Z'
      AND "expires_at" = '2099-02-01T00:00:00.000Z'
  ) THEN
    RAISE EXCEPTION 'Upgrade recalculated a frozen board expiry';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "anonymous_sessions"
    WHERE "id" = '50000000-0000-4000-8000-000000000003'
      AND "credential_hash" = repeat('C', 43)
      AND "created_at" = '2025-12-03T00:00:00.000Z'
      AND "expires_at" = '2099-01-03T00:00:00.000Z'
      AND "revoked_at" = '2026-06-01T00:00:00.000Z'
  ) THEN
    RAISE EXCEPTION 'Upgrade changed the revoked anonymous-session tombstone';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "board_memberships"
    WHERE "id" = '60000000-0000-4000-8000-000000000001'
      AND "board_id" = '11111111-1111-4111-8111-111111111111'
      AND "session_id" = '50000000-0000-4000-8000-000000000001'
      AND "role" = 'OWNER'
      AND "display_name" = 'Владелец'
      AND "created_at" = '2026-01-01T00:00:00.000Z'
      AND "revoked_at" IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM "board_memberships"
    WHERE "id" = '60000000-0000-4000-8000-000000000002'
      AND "session_id" = '50000000-0000-4000-8000-000000000002'
      AND "role" = 'PARTICIPANT'
      AND "created_at" = '2026-01-02T00:00:00.000Z'
      AND "revoked_at" = '2026-03-01T00:00:00.000Z'
  ) OR NOT EXISTS (
    SELECT 1
    FROM "board_memberships"
    WHERE "id" = '60000000-0000-4000-8000-000000000003'
      AND "session_id" = '50000000-0000-4000-8000-000000000002'
      AND "role" = 'PARTICIPANT'
      AND "created_at" = '2026-03-02T00:00:00.000Z'
      AND "revoked_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Upgrade changed owner or revoke/rejoin membership history';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "board_invitations"
    WHERE "id" = '70000000-0000-4000-8000-000000000003'
      AND "board_id" = '11111111-1111-4111-8111-111111111111'
      AND "token_hash" = repeat('F', 43)
      AND "role" = 'PARTICIPANT'
      AND "created_by_session_id" IS NULL
      AND "revoked_at" = '2026-04-02T00:00:00.000Z'
      AND "max_uses" = 1
      AND "use_count" = 0
  ) OR NOT EXISTS (
    SELECT 1
    FROM "board_invitations"
    WHERE "id" = '70000000-0000-4000-8000-000000000004'
      AND "board_id" = '22222222-2222-4222-8222-222222222222'
      AND "token_hash" = repeat('G', 43)
      AND "role" = 'OWNER'
      AND "created_by_session_id" IS NULL
      AND "revoked_at" IS NULL
      AND "max_uses" = 1
      AND "use_count" = 0
  ) THEN
    RAISE EXCEPTION 'Upgrade changed invitation creator tombstones or owner claims';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "invitation_redemptions"
    WHERE "id" = '80000000-0000-4000-8000-000000000001'
      AND "invitation_id" = '70000000-0000-4000-8000-000000000001'
      AND "membership_id" = '60000000-0000-4000-8000-000000000002'
      AND "board_id" = '11111111-1111-4111-8111-111111111111'
      AND "session_id" = '50000000-0000-4000-8000-000000000002'
  ) OR NOT EXISTS (
    SELECT 1
    FROM "invitation_redemptions"
    WHERE "id" = '80000000-0000-4000-8000-000000000002'
      AND "invitation_id" = '70000000-0000-4000-8000-000000000002'
      AND "membership_id" = '60000000-0000-4000-8000-000000000003'
      AND "board_id" = '11111111-1111-4111-8111-111111111111'
      AND "session_id" = '50000000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'Upgrade changed invitation redemption links';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "rate_limit_buckets"
    WHERE "key" = repeat('f', 64)
      AND "count" = 7
      AND "reset_at" = '2099-01-01T00:00:00.000Z'
  ) THEN
    RAISE EXCEPTION 'Upgrade changed the seeded rate-limit bucket';
  END IF;

  IF NOT has_target_schema THEN
    IF (SELECT COUNT(*) FROM "cards") <> 7
      OR (SELECT COUNT(*) FROM "cards" WHERE "column" = 'ACTIONS') <> 2
    THEN
      RAISE EXCEPTION 'Current baseline data changed before target migrations exist';
    END IF;

    RETURN;
  END IF;

  IF (SELECT COUNT(*) FROM "board_columns") <> 4
    OR (SELECT COUNT(*) FROM "cards") <> 5
    OR (SELECT COUNT(*) FROM "action_items") <> 2
  THEN
    RAISE EXCEPTION 'Target upgrade did not preserve the expected product rows';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "boards"
    WHERE "id" = '11111111-1111-4111-8111-111111111111'
      AND "title" = 'Ретроспектива 11111111'
      AND "cards_enabled"
      AND "voting_enabled"
      AND NOT "read_only"
      AND "revision" = 0
  ) OR NOT EXISTS (
    SELECT 1
    FROM "boards"
    WHERE "id" = '22222222-2222-4222-8222-222222222222'
      AND "title" = 'Ретроспектива 22222222'
      AND "cards_enabled"
      AND "voting_enabled"
      AND NOT "read_only"
      AND "revision" = 0
  ) THEN
    RAISE EXCEPTION 'Target upgrade generated unexpected legacy board titles';
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
    RAISE EXCEPTION 'Target upgrade generated unexpected default columns';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "cards" AS card
    JOIN "board_columns" AS board_column ON board_column."id" = card."column_id"
    WHERE card."id" = '30000000-0000-4000-8000-000000000001'
      AND board_column."title" = 'Уже хорошо'
      AND card."position" = 1024
      AND card."author" IS NULL
      AND card."created_by_membership_id" IS NULL
      AND card."updated_at" = card."created_at"
  ) OR NOT EXISTS (
    SELECT 1
    FROM "cards" AS card
    JOIN "board_columns" AS board_column ON board_column."id" = card."column_id"
    WHERE card."id" = '30000000-0000-4000-8000-000000000002'
      AND board_column."title" = 'Уже хорошо'
      AND card."position" = 2048
  ) OR NOT EXISTS (
    SELECT 1
    FROM "cards" AS card
    JOIN "board_columns" AS board_column ON board_column."id" = card."column_id"
    WHERE card."id" = '30000000-0000-4000-8000-000000000006'
      AND board_column."title" = 'Уже хорошо'
      AND card."position" = 1024
  ) OR NOT EXISTS (
    SELECT 1
    FROM "cards" AS card
    JOIN "board_columns" AS board_column ON board_column."id" = card."column_id"
    WHERE card."id" = '30000000-0000-4000-8000-000000000005'
      AND board_column."title" = 'Уже хорошо'
      AND card."position" = 2048
  ) THEN
    RAISE EXCEPTION 'Target card backfill order or ownership changed';
  END IF;

  IF EXISTS (
    WITH expected(
      "id",
      "board_id",
      "legacy_column",
      "column_title",
      "text",
      "position",
      "created_at"
    ) AS (
      VALUES
        (
          '30000000-0000-4000-8000-000000000001'::uuid,
          '11111111-1111-4111-8111-111111111111'::uuid,
          'WENT_WELL'::text,
          'Уже хорошо'::text,
          'Хорошая коммуникация 🚀'::text,
          1024,
          '2026-07-31T10:04:00.000Z'::timestamptz
        ),
        (
          '30000000-0000-4000-8000-000000000002'::uuid,
          '11111111-1111-4111-8111-111111111111'::uuid,
          'WENT_WELL'::text,
          'Уже хорошо'::text,
          'Меньше встреч'::text,
          2048,
          '2026-07-31T10:03:00.000Z'::timestamptz
        ),
        (
          '30000000-0000-4000-8000-000000000003'::uuid,
          '11111111-1111-4111-8111-111111111111'::uuid,
          'TO_IMPROVE'::text,
          'Следует улучшить'::text,
          '  =HYPERLINK("https://example.test")'::text,
          1024,
          '2026-07-31T10:02:00.000Z'::timestamptz
        ),
        (
          '30000000-0000-4000-8000-000000000005'::uuid,
          '22222222-2222-4222-8222-222222222222'::uuid,
          'WENT_WELL'::text,
          'Уже хорошо'::text,
          'Legacy card A'::text,
          2048,
          '2026-07-01T09:00:00.000Z'::timestamptz
        ),
        (
          '30000000-0000-4000-8000-000000000006'::uuid,
          '22222222-2222-4222-8222-222222222222'::uuid,
          'WENT_WELL'::text,
          'Уже хорошо'::text,
          'Legacy card B'::text,
          1024,
          '2026-07-01T09:00:00.000Z'::timestamptz
        )
    )
    SELECT 1
    FROM expected
    LEFT JOIN "cards" AS card ON card."id" = expected."id"
    LEFT JOIN "board_columns" AS board_column
      ON board_column."id" = card."column_id"
     AND board_column."board_id" = card."board_id"
    WHERE card."id" IS NULL
       OR card."board_id" IS DISTINCT FROM expected."board_id"
       OR card."column"::text IS DISTINCT FROM expected."legacy_column"
       OR board_column."title" IS DISTINCT FROM expected."column_title"
       OR card."text" IS DISTINCT FROM expected."text"
       OR card."owner" IS NOT NULL
       OR card."author" IS NOT NULL
       OR card."created_by_membership_id" IS NOT NULL
       OR card."position" IS DISTINCT FROM expected."position"
       OR card."group_id" IS NOT NULL
       OR card."group_position" IS NOT NULL
       OR card."created_at" IS DISTINCT FROM expected."created_at"
       OR card."updated_at" IS DISTINCT FROM expected."created_at"
  ) THEN
    RAISE EXCEPTION 'Target feedback card values changed during backfill';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "action_items"
    WHERE "id" = '30000000-0000-4000-8000-000000000004'
      AND "board_id" = '11111111-1111-4111-8111-111111111111'
      AND "text" = E'Добавить "шаблон"\nприёмки'
      AND "assignee" = '+Оля'
      AND NOT "completed"
      AND "source_card_id" IS NULL
      AND "position" = 1024
      AND "created_at" = '2026-07-31T10:01:00.000Z'
      AND "updated_at" = "created_at"
  ) OR NOT EXISTS (
    SELECT 1
    FROM "action_items"
    WHERE "id" = '30000000-0000-4000-8000-000000000007'
      AND "board_id" = '22222222-2222-4222-8222-222222222222'
      AND "text" = 'Legacy action'
      AND "assignee" = 'Иван'
      AND NOT "completed"
      AND "source_card_id" IS NULL
      AND "position" = 1024
      AND "created_at" = '2026-07-01T08:00:00.000Z'
      AND "updated_at" = "created_at"
  ) THEN
    RAISE EXCEPTION 'Target ACTIONS to ActionItem mapping changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "votes" AS vote
    JOIN "cards" AS card ON card."id" = vote."card_id"
    WHERE vote."column_id" IS DISTINCT FROM card."column_id"
  ) THEN
    RAISE EXCEPTION 'Target vote column no longer matches its card';
  END IF;

  IF EXISTS (
    WITH expected(
      "id",
      "board_id",
      "card_id",
      "legacy_column",
      "visitor_token",
      "quota_slot",
      "created_at"
    ) AS (
      VALUES
        (
          '40000000-0000-4000-8000-000000000001'::uuid,
          '11111111-1111-4111-8111-111111111111'::uuid,
          '30000000-0000-4000-8000-000000000001'::uuid,
          'WENT_WELL'::text,
          repeat('H', 43),
          1::smallint,
          '2026-07-31T10:05:00.000Z'::timestamptz
        ),
        (
          '40000000-0000-4000-8000-000000000002'::uuid,
          '11111111-1111-4111-8111-111111111111'::uuid,
          '30000000-0000-4000-8000-000000000002'::uuid,
          'WENT_WELL'::text,
          repeat('H', 43),
          2::smallint,
          '2026-07-31T10:06:00.000Z'::timestamptz
        ),
        (
          '40000000-0000-4000-8000-000000000003'::uuid,
          '11111111-1111-4111-8111-111111111111'::uuid,
          '30000000-0000-4000-8000-000000000001'::uuid,
          'WENT_WELL'::text,
          repeat('I', 43),
          1::smallint,
          '2026-07-31T10:07:00.000Z'::timestamptz
        ),
        (
          '40000000-0000-4000-8000-000000000004'::uuid,
          '11111111-1111-4111-8111-111111111111'::uuid,
          '30000000-0000-4000-8000-000000000003'::uuid,
          'TO_IMPROVE'::text,
          repeat('H', 43),
          1::smallint,
          '2026-07-31T10:08:00.000Z'::timestamptz
        ),
        (
          '40000000-0000-4000-8000-000000000005'::uuid,
          '22222222-2222-4222-8222-222222222222'::uuid,
          '30000000-0000-4000-8000-000000000005'::uuid,
          'WENT_WELL'::text,
          repeat('J', 43),
          1::smallint,
          '2026-07-01T09:01:00.000Z'::timestamptz
        )
    )
    SELECT 1
    FROM expected
    LEFT JOIN "votes" AS vote ON vote."id" = expected."id"
    LEFT JOIN "cards" AS card
      ON card."id" = vote."card_id"
     AND card."board_id" = vote."board_id"
    WHERE vote."id" IS NULL
       OR vote."board_id" IS DISTINCT FROM expected."board_id"
       OR vote."card_id" IS DISTINCT FROM expected."card_id"
       OR vote."column"::text IS DISTINCT FROM expected."legacy_column"
       OR vote."column_id" IS DISTINCT FROM card."column_id"
       OR vote."visitor_token" IS DISTINCT FROM expected."visitor_token"
       OR vote."quota_slot" IS DISTINCT FROM expected."quota_slot"
       OR vote."created_at" IS DISTINCT FROM expected."created_at"
  ) THEN
    RAISE EXCEPTION 'Target upgrade changed a legacy vote identity or timestamp';
  END IF;

  IF (
    SELECT array_agg("quota_slot" ORDER BY "quota_slot")
    FROM "votes"
    WHERE "board_id" = '11111111-1111-4111-8111-111111111111'
      AND "visitor_token" = repeat('H', 43)
      AND "column_id" = (
        SELECT "id"
        FROM "board_columns"
        WHERE "board_id" = '11111111-1111-4111-8111-111111111111'
          AND "title" = 'Уже хорошо'
      )
  ) IS DISTINCT FROM ARRAY[1, 2]::smallint[] THEN
    RAISE EXCEPTION 'Target upgrade changed legacy vote quota slots';
  END IF;

  IF EXISTS (
    WITH expected("table_name", "column_name", "data_type", "is_nullable") AS (
      VALUES
        ('boards', 'revision', 'bigint', 'NO'),
        ('cards', 'column', 'USER-DEFINED', 'YES'),
        ('cards', 'column_id', 'uuid', 'NO'),
        ('cards', 'updated_at', 'timestamp with time zone', 'NO'),
        ('board_columns', 'vote_limit', 'smallint', 'NO'),
        ('votes', 'column', 'USER-DEFINED', 'YES'),
        ('votes', 'column_id', 'uuid', 'NO'),
        ('votes', 'quota_slot', 'smallint', 'NO')
    )
    SELECT 1
    FROM expected
    LEFT JOIN information_schema.columns AS actual
      ON actual.table_schema = current_schema()
     AND actual.table_name = expected."table_name"
     AND actual.column_name = expected."column_name"
    WHERE actual.column_name IS NULL
       OR actual.data_type IS DISTINCT FROM expected."data_type"
       OR actual.is_nullable IS DISTINCT FROM expected."is_nullable"
  ) THEN
    RAISE EXCEPTION 'Target physical column type or nullability changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'votes'::regclass
      AND conname = 'votes_board_id_column_id_visitor_token_quota_slot_key'
      AND contype = 'u'
      AND condeferrable
      AND NOT condeferred
  ) OR EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('cards'::regclass, 'cards_group_id_board_id_column_id_fkey'),
        ('card_groups'::regclass, 'card_groups_primary_card_id_board_id_column_id_fkey'),
        ('votes'::regclass, 'votes_card_id_board_id_column_id_fkey')
    ) AS expected("relation_id", "constraint_name")
    LEFT JOIN pg_constraint AS actual
      ON actual.conrelid = expected."relation_id"
     AND actual.conname = expected."constraint_name"
    WHERE actual.oid IS NULL
       OR NOT actual.condeferrable
       OR NOT actual.condeferred
  ) THEN
    RAISE EXCEPTION 'Target deferrable constraints changed';
  END IF;

  IF to_regclass('votes_board_id_column_visitor_token_quota_slot_key') IS NOT NULL THEN
    RAISE EXCEPTION 'Incompatible legacy vote-slot unique index remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'action_items'::regclass
      AND conname = 'action_items_source_card_id_board_id_fkey'
      AND pg_get_constraintdef(oid) LIKE '%ON DELETE SET NULL (source_card_id)%'
  ) THEN
    RAISE EXCEPTION 'Action-item source FK no longer clears only source_card_id';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_index
    WHERE indexrelid = 'cards_board_id_column_id_position_id_ungrouped_idx'::regclass
      AND indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Target ungrouped-card ordering index is not partial';
  END IF;
END
$$;

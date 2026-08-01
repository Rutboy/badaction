DO $$
BEGIN
  IF (SELECT COUNT(*) FROM "boards") <> 2
    OR (SELECT COUNT(*) FROM "cards") <> 7
    OR (SELECT COUNT(*) FROM "votes") <> 5
    OR (SELECT COUNT(*) FROM "anonymous_sessions") <> 3
    OR (SELECT COUNT(*) FROM "board_memberships") <> 3
    OR (SELECT COUNT(*) FROM "board_invitations") <> 4
    OR (SELECT COUNT(*) FROM "invitation_redemptions") <> 2
    OR (SELECT COUNT(*) FROM "rate_limit_buckets") <> 1
  THEN
    RAISE EXCEPTION 'Stage 0 baseline fixture row counts changed';
  END IF;

  IF (SELECT COUNT(*) FROM "cards" WHERE "column" = 'ACTIONS') <> 2
    OR EXISTS (
      SELECT 1
      FROM "votes" AS vote
      JOIN "cards" AS card ON card."id" = vote."card_id"
      WHERE card."column" = 'ACTIONS'
    )
  THEN
    RAISE EXCEPTION 'Stage 0 legacy column fixture is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "board_memberships" AS previous_membership
    JOIN "board_memberships" AS current_membership
      ON current_membership."board_id" = previous_membership."board_id"
      AND current_membership."session_id" = previous_membership."session_id"
    WHERE previous_membership."id" = '60000000-0000-4000-8000-000000000002'
      AND previous_membership."revoked_at" IS NOT NULL
      AND current_membership."id" = '60000000-0000-4000-8000-000000000003'
      AND current_membership."revoked_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Stage 0 revoke/rejoin history fixture is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "anonymous_sessions"
    WHERE "id" = '50000000-0000-4000-8000-000000000003'
      AND "revoked_at" IS NOT NULL
      AND "expires_at" > "revoked_at"
  ) THEN
    RAISE EXCEPTION 'Stage 0 revoked-session tombstone fixture is invalid';
  END IF;
END
$$;

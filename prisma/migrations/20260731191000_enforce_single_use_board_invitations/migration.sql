BEGIN;

-- Invitation URLs are bearer credentials. Reusable links prevent precise
-- participant revocation, so every invitation is deliberately single-use.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "board_invitations"
    WHERE "max_uses" <> 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce single-use invitations: reusable invitation rows exist'
      USING HINT = 'Revoke or replace reusable invitations before retrying the migration.';
  END IF;
END
$$;

ALTER TABLE "board_invitations"
  ADD CONSTRAINT "board_invitations_single_use_check"
    CHECK ("max_uses" = 1);

COMMIT;

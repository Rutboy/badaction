BEGIN;

ALTER TABLE "board_invitations"
  DROP CONSTRAINT "board_invitations_role_creator_check",
  ADD CONSTRAINT "board_invitations_owner_creator_check"
    CHECK ("role" <> 'OWNER' OR "created_by_session_id" IS NULL);

-- PARTICIPANT invitations are created by an owner in application code. The
-- creator becomes NULL only when an expired session is deleted through the
-- existing ON DELETE SET NULL foreign key, preserving the invitation audit row.

COMMIT;

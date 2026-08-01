BEGIN;

ALTER TABLE "invitation_redemptions"
  ADD COLUMN "membership_id" UUID,
  ADD COLUMN "board_id" UUID;

UPDATE "invitation_redemptions" AS redemption
SET
  "membership_id" = membership."id",
  "board_id" = invitation."board_id"
FROM "board_invitations" AS invitation
INNER JOIN "board_memberships" AS membership
  ON membership."board_id" = invitation."board_id"
WHERE invitation."id" = redemption."invitation_id"
  AND membership."session_id" = redemption."session_id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "invitation_redemptions"
    WHERE "membership_id" IS NULL OR "board_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot link invitation redemptions to board memberships'
      USING HINT = 'Repair orphaned invitation redemption rows before retrying the migration.';
  END IF;
END
$$;

ALTER TABLE "invitation_redemptions"
  ALTER COLUMN "membership_id" SET NOT NULL,
  ALTER COLUMN "board_id" SET NOT NULL;

DROP INDEX "board_memberships_board_id_session_id_key";

CREATE UNIQUE INDEX "board_memberships_id_board_id_session_id_key"
  ON "board_memberships"("id", "board_id", "session_id");
CREATE UNIQUE INDEX "board_memberships_one_active_session_per_board"
  ON "board_memberships"("board_id", "session_id")
  WHERE "revoked_at" IS NULL;
CREATE INDEX "board_memberships_board_id_session_id_revoked_at_idx"
  ON "board_memberships"("board_id", "session_id", "revoked_at");

CREATE UNIQUE INDEX "board_invitations_id_board_id_key"
  ON "board_invitations"("id", "board_id");
CREATE UNIQUE INDEX "board_invitations_one_outstanding_owner_claim"
  ON "board_invitations"("board_id")
  WHERE "role" = 'OWNER' AND "revoked_at" IS NULL;

ALTER TABLE "board_invitations"
  ADD CONSTRAINT "board_invitations_role_creator_check"
    CHECK (
      ("role" = 'OWNER' AND "created_by_session_id" IS NULL)
      OR
      ("role" = 'PARTICIPANT' AND "created_by_session_id" IS NOT NULL)
    );

ALTER TABLE "invitation_redemptions"
  DROP CONSTRAINT "invitation_redemptions_invitation_id_fkey",
  DROP CONSTRAINT "invitation_redemptions_session_id_fkey";

ALTER TABLE "invitation_redemptions"
  ADD CONSTRAINT "invitation_redemptions_invitation_id_board_id_fkey"
    FOREIGN KEY ("invitation_id", "board_id")
    REFERENCES "board_invitations"("id", "board_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "invitation_redemptions_membership_board_session_fkey"
    FOREIGN KEY ("membership_id", "board_id", "session_id")
    REFERENCES "board_memberships"("id", "board_id", "session_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "invitation_redemptions_membership_id_idx"
  ON "invitation_redemptions"("membership_id");

COMMIT;

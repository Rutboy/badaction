BEGIN;

ALTER TABLE "board_invitations"
  DROP CONSTRAINT "board_invitations_single_use_check";

ALTER TABLE "board_invitations"
  ADD CONSTRAINT "board_invitations_participant_max_uses_check"
    CHECK ("role" <> 'PARTICIPANT' OR "max_uses" BETWEEN 1 AND 100);

COMMIT;

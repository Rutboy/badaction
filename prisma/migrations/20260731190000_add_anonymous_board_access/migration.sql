BEGIN;

CREATE TYPE "BoardMembershipRole" AS ENUM ('OWNER', 'PARTICIPANT');

CREATE TABLE "anonymous_sessions" (
  "id" UUID NOT NULL,
  "credential_hash" VARCHAR(43) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),

  CONSTRAINT "anonymous_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "anonymous_sessions_credential_hash_length_check"
    CHECK (length("credential_hash") = 43),
  CONSTRAINT "anonymous_sessions_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "anonymous_sessions_revoked_at_check"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);

CREATE TABLE "board_memberships" (
  "id" UUID NOT NULL,
  "board_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "role" "BoardMembershipRole" NOT NULL,
  "display_name" VARCHAR(80) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revoked_at" TIMESTAMPTZ(3),

  CONSTRAINT "board_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_memberships_display_name_check"
    CHECK (length(btrim("display_name")) BETWEEN 1 AND 80),
  CONSTRAINT "board_memberships_revoked_at_check"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);

CREATE TABLE "board_invitations" (
  "id" UUID NOT NULL,
  "board_id" UUID NOT NULL,
  "token_hash" VARCHAR(43) NOT NULL,
  "role" "BoardMembershipRole" NOT NULL,
  "created_by_session_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "max_uses" INTEGER NOT NULL DEFAULT 1,
  "use_count" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "board_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "board_invitations_token_hash_length_check"
    CHECK (length("token_hash") = 43),
  CONSTRAINT "board_invitations_expiry_check"
    CHECK ("expires_at" > "created_at"),
  CONSTRAINT "board_invitations_revoked_at_check"
    CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at"),
  CONSTRAINT "board_invitations_uses_check"
    CHECK ("max_uses" >= 1 AND "use_count" >= 0 AND "use_count" <= "max_uses"),
  CONSTRAINT "board_invitations_owner_single_use_check"
    CHECK ("role" <> 'OWNER' OR "max_uses" = 1)
);

CREATE TABLE "invitation_redemptions" (
  "id" UUID NOT NULL,
  "invitation_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invitation_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "anonymous_sessions_credential_hash_key"
  ON "anonymous_sessions"("credential_hash");
CREATE INDEX "anonymous_sessions_expires_at_idx"
  ON "anonymous_sessions"("expires_at");

CREATE UNIQUE INDEX "board_memberships_board_id_session_id_key"
  ON "board_memberships"("board_id", "session_id");
CREATE UNIQUE INDEX "board_memberships_one_active_owner_per_board"
  ON "board_memberships"("board_id")
  WHERE "role" = 'OWNER' AND "revoked_at" IS NULL;
CREATE INDEX "board_memberships_board_id_role_revoked_at_idx"
  ON "board_memberships"("board_id", "role", "revoked_at");
CREATE INDEX "board_memberships_session_id_revoked_at_idx"
  ON "board_memberships"("session_id", "revoked_at");

CREATE UNIQUE INDEX "board_invitations_token_hash_key"
  ON "board_invitations"("token_hash");
CREATE INDEX "board_invitations_board_id_role_revoked_at_expires_at_idx"
  ON "board_invitations"("board_id", "role", "revoked_at", "expires_at");
CREATE INDEX "board_invitations_created_by_session_id_idx"
  ON "board_invitations"("created_by_session_id");

CREATE UNIQUE INDEX "invitation_redemptions_invitation_id_session_id_key"
  ON "invitation_redemptions"("invitation_id", "session_id");
CREATE INDEX "invitation_redemptions_session_id_idx"
  ON "invitation_redemptions"("session_id");

ALTER TABLE "board_memberships"
  ADD CONSTRAINT "board_memberships_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "board_memberships_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "anonymous_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "board_invitations"
  ADD CONSTRAINT "board_invitations_board_id_fkey"
    FOREIGN KEY ("board_id") REFERENCES "boards"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "board_invitations_created_by_session_id_fkey"
    FOREIGN KEY ("created_by_session_id") REFERENCES "anonymous_sessions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invitation_redemptions"
  ADD CONSTRAINT "invitation_redemptions_invitation_id_fkey"
    FOREIGN KEY ("invitation_id") REFERENCES "board_invitations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "invitation_redemptions_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "anonymous_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Intentionally do not backfill memberships. Before creator credentials were
-- persisted, there was no trustworthy way to infer an owner. Legacy boards
-- therefore remain inaccessible until an operator issues an OWNER claim token.

COMMIT;

import test from "node:test";
import assert from "node:assert/strict";
import {
  createInvitationSchema,
  patchMembershipSchema,
  redeemInvitationSchema,
} from "./access.ts";

test("validates bounded participant invitation uses", () => {
  assert.deepEqual(createInvitationSchema.parse({}), { maxUses: 1 });
  assert.deepEqual(createInvitationSchema.parse({ maxUses: 25 }), { maxUses: 25 });
  for (const maxUses of [0, 1.5, 101, "10"]) {
    assert.equal(createInvitationSchema.safeParse({ maxUses }).success, false);
  }
  assert.equal(
    createInvitationSchema.safeParse({ maxUses: 10, role: "OWNER" }).success,
    false,
  );
});

test("validates a 256-bit base64url invitation and trims display name", () => {
  const token = "A".repeat(43);
  assert.deepEqual(
    redeemInvitationSchema.parse({ token, displayName: "  Оля  " }),
    { token, displayName: "Оля" },
  );
});

test("rejects malformed invitations and empty or oversized names", () => {
  assert.equal(redeemInvitationSchema.safeParse({ token: "short" }).success, false);
  assert.equal(
    redeemInvitationSchema.safeParse({ token: "A".repeat(43), displayName: "   " }).success,
    false,
  );
  assert.equal(
    redeemInvitationSchema.safeParse({ token: "A".repeat(43), displayName: "x".repeat(81) }).success,
    false,
  );
});

test("validates and trims membership display name updates", () => {
  assert.deepEqual(
    patchMembershipSchema.parse({ displayName: "  Новое имя  " }),
    { displayName: "Новое имя" },
  );
  assert.equal(patchMembershipSchema.safeParse({ displayName: "   " }).success, false);
  assert.equal(
    patchMembershipSchema.safeParse({ displayName: "x".repeat(81) }).success,
    false,
  );
  assert.equal(
    patchMembershipSchema.safeParse({ displayName: "Имя", role: "OWNER" }).success,
    false,
  );
});

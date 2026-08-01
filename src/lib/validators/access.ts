import { z } from "zod";
import { MAX_PARTICIPANT_INVITATION_USES } from "../constants/access.ts";

export const invitationTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "Некорректный токен приглашения");

export const redeemInvitationSchema = z.object({
  token: invitationTokenSchema,
  displayName: z.string().trim().min(1).max(80).optional(),
});

export const createInvitationSchema = z
  .object({
    maxUses: z.number().int().min(1).max(MAX_PARTICIPANT_INVITATION_USES).default(1),
  })
  .strict();

export const patchMembershipSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();

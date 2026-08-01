import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createLegacyOwnerClaimInvitation,
  createParticipantInvitation,
  deleteBoardAsOwner,
  leaveBoard,
  listBoardInvitations,
  listBoardParticipants,
  redeemBoardInvitation,
  requireActiveBoardMember,
  revokeBoardInvitation,
  revokeBoardParticipant,
  updateCurrentMembershipDisplayName,
} from "./acl-service.ts";
import {
  MAX_BOARD_OWNER_HISTORY_RECORDS,
  MAX_BOARD_PARTICIPANT_INVITATION_RECORDS,
  MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS,
} from "../constants/access.ts";
import { deriveSessionCredentialHash } from "./session-service.ts";
import { prisma } from "../prisma/client.ts";
import { createBoard, getBoard } from "../services/boards-service.ts";

const databaseTest = process.env.RUN_DATABASE_TESTS === "1" ? test : test.skip;
const createVisitorPayload = () => randomBytes(32).toString("base64url");
const hasCode = (code) => (error) => error?.code === code;

databaseTest("anonymous ACL protects UUIDs and supports invite, revoke, leave, and delete", async () => {
  const boardIds = [];
  const payloads = [];

  try {
    const ownerPayload = createVisitorPayload();
    const participantPayload = createVisitorPayload();
    const outsiderPayload = createVisitorPayload();
    payloads.push(ownerPayload, participantPayload, outsiderPayload);

    const board = await createBoard(ownerPayload);
    boardIds.push(board.id);
    const owner = await requireActiveBoardMember(board.id, ownerPayload);
    assert.equal(owner.role, "OWNER");
    const renamedOwner = await updateCurrentMembershipDisplayName(
      board.id,
      ownerPayload,
      "  Алексей  ",
    );
    assert.equal(renamedOwner.displayName, "Алексей");
    assert.equal(
      (await requireActiveBoardMember(board.id, ownerPayload)).displayName,
      "Алексей",
    );
    await assert.rejects(
      () => getBoard(board.id, outsiderPayload),
      hasCode("BOARD_NOT_FOUND"),
    );
    await assert.rejects(
      () => createParticipantInvitation(board.id, outsiderPayload),
      hasCode("BOARD_NOT_FOUND"),
    );

    const invitation = await createParticipantInvitation(board.id, ownerPayload);
    assert.match(invitation.token, /^[A-Za-z0-9_-]{43}$/);
    const storedInvitation = await prisma.boardInvitation.findUniqueOrThrow({
      where: { id: invitation.id },
      select: { tokenHash: true, useCount: true },
    });
    assert.notEqual(storedInvitation.tokenHash, invitation.token);
    assert.equal(storedInvitation.useCount, 0);

    const redeemed = await redeemBoardInvitation(
      invitation.token,
      participantPayload,
      "  Участник 1  ",
    );
    assert.equal(redeemed.role, "PARTICIPANT");
    assert.equal(redeemed.displayName, "Участник 1");
    const repeated = await redeemBoardInvitation(
      invitation.token,
      participantPayload,
      "Другое имя",
    );
    assert.equal(repeated.membershipId, redeemed.membershipId);
    assert.equal(
      (await prisma.boardInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).useCount,
      1,
    );
    const redemptionRecord = await prisma.invitationRedemption.findUniqueOrThrow({
      where: {
        invitationId_sessionId: {
          invitationId: invitation.id,
          sessionId: (await requireActiveBoardMember(board.id, participantPayload)).sessionId,
        },
      },
    });
    assert.equal(redemptionRecord.membershipId, redeemed.membershipId);
    assert.equal(redemptionRecord.boardId, board.id);
    await assert.rejects(
      () => redeemBoardInvitation(invitation.token, outsiderPayload),
      hasCode("INVITATION_INVALID"),
    );

    const participantBoard = await getBoard(board.id, participantPayload, 1);
    assert.equal(participantBoard.access.role, "PARTICIPANT");
    await assert.rejects(
      () => createParticipantInvitation(board.id, participantPayload),
      hasCode("BOARD_OWNER_REQUIRED"),
    );

    const unusedInvitation = await createParticipantInvitation(board.id, ownerPayload);
    const alreadyActive = await redeemBoardInvitation(
      unusedInvitation.token,
      participantPayload,
      "Имя не меняется",
    );
    assert.equal(alreadyActive.membershipId, redeemed.membershipId);
    assert.equal(
      (await prisma.boardInvitation.findUniqueOrThrow({
        where: { id: unusedInvitation.id },
      })).useCount,
      1,
    );
    const activeMembershipRedemption = await prisma.invitationRedemption.findUniqueOrThrow({
      where: {
        invitationId_sessionId: {
          invitationId: unusedInvitation.id,
          sessionId: (await requireActiveBoardMember(board.id, participantPayload)).sessionId,
        },
      },
    });
    assert.equal(activeMembershipRedemption.membershipId, redeemed.membershipId);
    const repeatedActiveMembershipRedeem = await redeemBoardInvitation(
      unusedInvitation.token,
      participantPayload,
      "Имя всё ещё не меняется",
    );
    assert.equal(repeatedActiveMembershipRedeem.membershipId, redeemed.membershipId);
    assert.equal(
      (await prisma.boardInvitation.findUniqueOrThrow({
        where: { id: unusedInvitation.id },
      })).useCount,
      1,
    );

    const renamedParticipant = await updateCurrentMembershipDisplayName(
      board.id,
      participantPayload,
      "  Мария  ",
    );
    assert.equal(renamedParticipant.displayName, "Мария");
    const noOpRename = await updateCurrentMembershipDisplayName(
      board.id,
      participantPayload,
      "Мария",
    );
    assert.equal(noOpRename.revision, renamedParticipant.revision);
    await assert.rejects(
      () => updateCurrentMembershipDisplayName(board.id, participantPayload, "   "),
      hasCode("VALIDATION_ERROR"),
    );

    const participants = await listBoardParticipants(board.id, ownerPayload);
    assert.equal(participants.participants.length, 1);
    assert.equal(participants.participants[0].displayName, "Мария");
    assert.equal((await listBoardInvitations(board.id, ownerPayload)).length, 2);

    await revokeBoardParticipant(board.id, redeemed.membershipId, ownerPayload);
    await assert.rejects(
      () => getBoard(board.id, participantPayload),
      hasCode("BOARD_NOT_FOUND"),
    );
    await assert.rejects(
      () => redeemBoardInvitation(unusedInvitation.token, participantPayload),
      hasCode("INVITATION_INVALID"),
    );

    const secondInvitation = await createParticipantInvitation(board.id, ownerPayload);
    const reactivated = await redeemBoardInvitation(
      secondInvitation.token,
      participantPayload,
      "Участник вернулся",
    );
    assert.notEqual(reactivated.membershipId, redeemed.membershipId);
    assert.ok(
      (await prisma.boardMembership.findUniqueOrThrow({
        where: { id: redeemed.membershipId },
      })).revokedAt,
    );
    await leaveBoard(board.id, participantPayload);
    await assert.rejects(
      () => getBoard(board.id, participantPayload),
      hasCode("BOARD_NOT_FOUND"),
    );

    const secondOwnerBoard = await createBoard(ownerPayload);
    boardIds.push(secondOwnerBoard.id);
    await deleteBoardAsOwner(board.id, ownerPayload);
    assert.equal(await prisma.board.count({ where: { id: board.id } }), 0);
    assert.equal(
      await prisma.anonymousSession.count({
        where: { credentialHash: deriveSessionCredentialHash(participantPayload) },
      }),
      0,
    );
    assert.equal(
      await prisma.anonymousSession.count({
        where: { credentialHash: deriveSessionCredentialHash(ownerPayload) },
      }),
      1,
    );
    await deleteBoardAsOwner(secondOwnerBoard.id, ownerPayload);
    assert.equal(
      await prisma.anonymousSession.count({
        where: { credentialHash: deriveSessionCredentialHash(ownerPayload) },
      }),
      0,
    );
  } finally {
    await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: payloads.map((payload) => deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

databaseTest("immediate invitation and membership revocation preserve timestamp checks", async () => {
  const ownerPayload = createVisitorPayload();
  const participantPayload = createVisitorPayload();
  let boardId;

  try {
    const board = await createBoard(ownerPayload);
    boardId = board.id;

    const invitationToRevoke = await createParticipantInvitation(board.id, ownerPayload);
    const invitationCreatedAt = (
      await prisma.boardInvitation.findUniqueOrThrow({
        where: { id: invitationToRevoke.id },
        select: { createdAt: true },
      })
    ).createdAt;
    await revokeBoardInvitation(board.id, invitationToRevoke.id, ownerPayload, {
      now: new Date(invitationCreatedAt.getTime() - 1),
    });
    const revokedInvitation = await prisma.boardInvitation.findUniqueOrThrow({
      where: { id: invitationToRevoke.id },
      select: { revokedAt: true },
    });
    assert.equal(revokedInvitation.revokedAt?.getTime(), invitationCreatedAt.getTime());

    const invitationToRedeem = await createParticipantInvitation(board.id, ownerPayload);
    const membership = await redeemBoardInvitation(
      invitationToRedeem.token,
      participantPayload,
      "Участник",
    );
    const membershipCreatedAt = (
      await prisma.boardMembership.findUniqueOrThrow({
        where: { id: membership.membershipId },
        select: { createdAt: true },
      })
    ).createdAt;
    await leaveBoard(board.id, participantPayload, {
      now: new Date(membershipCreatedAt.getTime() - 1),
    });
    const revokedMembership = await prisma.boardMembership.findUniqueOrThrow({
      where: { id: membership.membershipId },
      select: { revokedAt: true },
    });
    assert.equal(revokedMembership.revokedAt?.getTime(), membershipCreatedAt.getTime());
  } finally {
    if (boardId) {
      await prisma.board.deleteMany({ where: { id: boardId } });
    }
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: [ownerPayload, participantPayload].map((payload) =>
            deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

databaseTest("single-use and legacy owner claims stay atomic under competition", async () => {
  const boardIds = [];
  const payloads = [];

  try {
    const ownerPayload = createVisitorPayload();
    const participantOne = createVisitorPayload();
    const participantTwo = createVisitorPayload();
    payloads.push(ownerPayload, participantOne, participantTwo);
    const board = await createBoard(ownerPayload);
    boardIds.push(board.id);
    const invitation = await createParticipantInvitation(board.id, ownerPayload);

    const competing = await Promise.allSettled([
      redeemBoardInvitation(invitation.token, participantOne, "Первый"),
      redeemBoardInvitation(invitation.token, participantTwo, "Второй"),
    ]);
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(competing.filter((result) => result.status === "rejected").length, 1);
    assert.equal(
      await prisma.boardMembership.count({
        where: { boardId: board.id, role: "PARTICIPANT", revokedAt: null },
      }),
      1,
    );

    const activeInvitations = [];
    for (let index = 0; index < 20; index += 1) {
      activeInvitations.push(await createParticipantInvitation(board.id, ownerPayload));
    }
    assert.equal(activeInvitations.length, 20);
    await assert.rejects(
      () => createParticipantInvitation(board.id, ownerPayload),
      hasCode("BOARD_INVITATION_LIMIT_REACHED"),
    );

    const legacyBoard = await prisma.board.create({
      data: {
        title: "Legacy owner claim",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    boardIds.push(legacyBoard.id);
    const legacyOwnerOne = createVisitorPayload();
    const legacyOwnerTwo = createVisitorPayload();
    payloads.push(legacyOwnerOne, legacyOwnerTwo);

    const staleClaim = await createLegacyOwnerClaimInvitation(legacyBoard.id);
    const staleClaimCreatedAt = (
      await prisma.boardInvitation.findUniqueOrThrow({
        where: { id: staleClaim.id },
        select: { createdAt: true },
      })
    ).createdAt;
    const currentClaim = await createLegacyOwnerClaimInvitation(legacyBoard.id, {
      // TIMESTAMPTZ(3) may round the database creation time one millisecond
      // ahead of the application clock used to revoke the prior claim.
      now: new Date(staleClaimCreatedAt.getTime() - 1),
    });
    const revokedStaleClaim = await prisma.boardInvitation.findUniqueOrThrow({
      where: { id: staleClaim.id },
      select: { revokedAt: true },
    });
    assert.equal(revokedStaleClaim.revokedAt?.getTime(), staleClaimCreatedAt.getTime());
    await assert.rejects(
      () => redeemBoardInvitation(staleClaim.token, legacyOwnerOne),
      hasCode("INVITATION_INVALID"),
    );
    const claimed = await redeemBoardInvitation(currentClaim.token, legacyOwnerTwo);
    assert.equal(claimed.role, "OWNER");
    await assert.rejects(
      () => createLegacyOwnerClaimInvitation(legacyBoard.id),
      hasCode("BOARD_OWNER_ALREADY_EXISTS"),
    );

    const staleOwnerPayload = createVisitorPayload();
    const recoveredOwnerPayload = createVisitorPayload();
    payloads.push(staleOwnerPayload, recoveredOwnerPayload);
    const staleOwnerBoard = await prisma.board.create({
      data: {
        title: "Stale owner recovery",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    boardIds.push(staleOwnerBoard.id);
    const staleSession = await prisma.anonymousSession.create({
      data: {
        credentialHash: deriveSessionCredentialHash(staleOwnerPayload),
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    });
    const staleMembership = await prisma.boardMembership.create({
      data: {
        boardId: staleOwnerBoard.id,
        sessionId: staleSession.id,
        role: "OWNER",
        displayName: "Прежний владелец",
      },
    });
    const recoveryClaim = await createLegacyOwnerClaimInvitation(staleOwnerBoard.id);
    assert.ok(
      (await prisma.boardMembership.findUniqueOrThrow({
        where: { id: staleMembership.id },
      })).revokedAt,
    );
    const recoveredOwner = await redeemBoardInvitation(
      recoveryClaim.token,
      recoveredOwnerPayload,
    );
    assert.equal(recoveredOwner.role, "OWNER");
  } finally {
    await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: payloads.map((payload) => deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

databaseTest("multi-use participant invitations stay bounded and visible after partial use", async () => {
  const boardIds = [];
  const payloads = [];

  try {
    const ownerPayload = createVisitorPayload();
    const participantPayloads = Array.from({ length: 4 }, () => createVisitorPayload());
    payloads.push(ownerPayload, ...participantPayloads);
    const board = await createBoard(ownerPayload);
    boardIds.push(board.id);
    const invitation = await createParticipantInvitation(board.id, ownerPayload, {
      maxUses: 3,
    });

    const firstMembership = await redeemBoardInvitation(
      invitation.token,
      participantPayloads[0],
      "Первый",
    );
    const partiallyUsed = (await listBoardInvitations(board.id, ownerPayload))
      .find((candidate) => candidate.id === invitation.id);
    assert.equal(partiallyUsed?.active, true);
    assert.equal(partiallyUsed?.useCount, 1);
    assert.equal(partiallyUsed?.maxUses, 3);

    await revokeBoardParticipant(board.id, firstMembership.membershipId, ownerPayload);
    await assert.rejects(
      () => redeemBoardInvitation(invitation.token, participantPayloads[0], "Первый снова"),
      hasCode("INVITATION_INVALID"),
    );

    const competing = await Promise.allSettled(participantPayloads.slice(1).map(
      (payload, index) => redeemBoardInvitation(invitation.token, payload, `Участник ${index + 2}`),
    ));
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 2);
    const rejected = competing.filter((result) => result.status === "rejected");
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason?.code, "INVITATION_INVALID");
    assert.equal(
      (await prisma.boardInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).useCount,
      3,
    );
    assert.equal(
      await prisma.boardMembership.count({
        where: { boardId: board.id, role: "PARTICIPANT", revokedAt: null },
      }),
      2,
    );
    const exhausted = (await listBoardInvitations(board.id, ownerPayload))
      .find((candidate) => candidate.id === invitation.id);
    assert.equal(exhausted?.active, false);
  } finally {
    await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: payloads.map((payload) => deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

databaseTest("participant quota rejects a 101st active anonymous member atomically", async () => {
  const payloads = [];
  let boardId;

  try {
    const ownerPayload = createVisitorPayload();
    const joiningPayload = createVisitorPayload();
    payloads.push(ownerPayload, joiningPayload);
    const board = await createBoard(ownerPayload);
    boardId = board.id;

    const seededParticipants = Array.from({ length: 100 }, (_, index) => {
      const payload = createVisitorPayload();
      payloads.push(payload);
      return {
        id: randomUUID(),
        payload,
        displayName: `Участник ${index + 1}`,
      };
    });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.anonymousSession.createMany({
      data: seededParticipants.map((participant) => ({
        id: participant.id,
        credentialHash: deriveSessionCredentialHash(participant.payload),
        expiresAt,
      })),
    });
    await prisma.boardMembership.createMany({
      data: seededParticipants.map((participant) => ({
        boardId: board.id,
        sessionId: participant.id,
        role: "PARTICIPANT",
        displayName: participant.displayName,
      })),
    });

    const invitation = await createParticipantInvitation(board.id, ownerPayload);
    await assert.rejects(
      () => redeemBoardInvitation(invitation.token, joiningPayload, "Лишний участник"),
      hasCode("BOARD_PARTICIPANT_LIMIT_REACHED"),
    );
    assert.equal(
      await prisma.boardMembership.count({
        where: { boardId: board.id, role: "PARTICIPANT", revokedAt: null },
      }),
      100,
    );
    assert.equal(
      (await prisma.boardInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).useCount,
      0,
    );
  } finally {
    if (boardId) {
      await prisma.board.deleteMany({ where: { id: boardId } });
    }
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: payloads.map((payload) => deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

databaseTest("hard ACL history quotas bound invitation, membership, redemption, and vote growth", async () => {
  const boardIds = [];
  const payloads = [];

  try {
    const invitationOwnerPayload = createVisitorPayload();
    payloads.push(invitationOwnerPayload);
    const invitationBoard = await createBoard(invitationOwnerPayload);
    boardIds.push(invitationBoard.id);
    const invitationOwner = await requireActiveBoardMember(
      invitationBoard.id,
      invitationOwnerPayload,
    );
    const activeInvitation = await createParticipantInvitation(
      invitationBoard.id,
      invitationOwnerPayload,
    );
    await prisma.boardInvitation.update({
      where: { id: activeInvitation.id },
      data: { createdAt: new Date(Date.now() - 2000) },
    });
    const createdAt = new Date(Date.now() - 1000);
    const revokedAt = new Date();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await prisma.boardInvitation.createMany({
      data: Array.from({ length: MAX_BOARD_PARTICIPANT_INVITATION_RECORDS - 1 }, () => ({
        boardId: invitationBoard.id,
        tokenHash: randomBytes(32).toString("base64url"),
        role: "PARTICIPANT",
        createdBySessionId: invitationOwner.sessionId,
        createdAt,
        expiresAt,
        revokedAt,
        maxUses: 1,
        useCount: 0,
      })),
    });
    await assert.rejects(
      () => createParticipantInvitation(invitationBoard.id, invitationOwnerPayload),
      hasCode("BOARD_INVITATION_HISTORY_LIMIT_REACHED"),
    );
    assert.equal(
      await prisma.boardInvitation.count({
        where: { boardId: invitationBoard.id, role: "PARTICIPANT" },
      }),
      MAX_BOARD_PARTICIPANT_INVITATION_RECORDS,
    );
    const invitationHistory = await listBoardInvitations(
      invitationBoard.id,
      invitationOwnerPayload,
    );
    assert.equal(invitationHistory.length, 100);
    assert.equal(invitationHistory[0].id, activeInvitation.id);
    assert.equal(invitationHistory[0].active, true);

    await prisma.boardInvitation.createMany({
      data: Array.from({ length: MAX_BOARD_OWNER_HISTORY_RECORDS }, () => ({
        boardId: invitationBoard.id,
        tokenHash: randomBytes(32).toString("base64url"),
        role: "OWNER",
        createdBySessionId: null,
        createdAt,
        expiresAt,
        revokedAt,
        maxUses: 1,
        useCount: 0,
      })),
    });
    await prisma.anonymousSession.update({
      where: { id: invitationOwner.sessionId },
      data: { revokedAt },
    });
    const invitationRecoveryPayload = createVisitorPayload();
    payloads.push(invitationRecoveryPayload);
    const invitationRecoveryClaim = await createLegacyOwnerClaimInvitation(invitationBoard.id);
    assert.equal(
      await prisma.boardInvitation.count({
        where: { boardId: invitationBoard.id, role: "OWNER" },
      }),
      MAX_BOARD_OWNER_HISTORY_RECORDS,
    );
    assert.equal(
      (await redeemBoardInvitation(invitationRecoveryClaim.token, invitationRecoveryPayload)).role,
      "OWNER",
    );

    const membershipOwnerPayload = createVisitorPayload();
    const joiningPayload = createVisitorPayload();
    const membershipRecoveryPayload = createVisitorPayload();
    payloads.push(membershipOwnerPayload, joiningPayload, membershipRecoveryPayload);
    const membershipBoard = await createBoard(membershipOwnerPayload);
    boardIds.push(membershipBoard.id);
    const membershipOwner = await requireActiveBoardMember(
      membershipBoard.id,
      membershipOwnerPayload,
    );
    const historicalParticipants = Array.from(
      { length: MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS },
      (_, index) => {
        const payload = createVisitorPayload();
        payloads.push(payload);
        return {
          id: randomUUID(),
          payload,
          displayName: `Бывший участник ${index + 1}`,
        };
      },
    );
    await prisma.anonymousSession.createMany({
      data: historicalParticipants.map((participant) => ({
        id: participant.id,
        credentialHash: deriveSessionCredentialHash(participant.payload),
        expiresAt,
      })),
    });
    await prisma.boardMembership.createMany({
      data: historicalParticipants.map((participant) => ({
        boardId: membershipBoard.id,
        sessionId: participant.id,
        role: "PARTICIPANT",
        displayName: participant.displayName,
        createdAt,
        revokedAt,
      })),
    });

    const invitation = await createParticipantInvitation(
      membershipBoard.id,
      membershipOwnerPayload,
    );
    await assert.rejects(
      () => redeemBoardInvitation(invitation.token, joiningPayload, "Лишний участник"),
      hasCode("BOARD_MEMBERSHIP_HISTORY_LIMIT_REACHED"),
    );
    assert.equal(
      await prisma.boardMembership.count({
        where: { boardId: membershipBoard.id, role: "PARTICIPANT" },
      }),
      MAX_BOARD_PARTICIPANT_MEMBERSHIP_RECORDS,
    );
    assert.equal(
      (await prisma.boardInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).useCount,
      0,
    );
    assert.equal(
      await prisma.invitationRedemption.count({ where: { boardId: membershipBoard.id } }),
      0,
    );

    await prisma.boardMembership.createMany({
      data: historicalParticipants
        .slice(0, MAX_BOARD_OWNER_HISTORY_RECORDS - 1)
        .map((participant) => ({
          boardId: membershipBoard.id,
          sessionId: participant.id,
          role: "OWNER",
          displayName: "Прежний владелец",
          createdAt,
          revokedAt,
        })),
    });
    const prunableOwnerMembership = await prisma.boardMembership.findFirstOrThrow({
      where: {
        boardId: membershipBoard.id,
        role: "OWNER",
        revokedAt: { not: null },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const membershipBoardColumn = await prisma.boardColumn.findFirstOrThrow({
      where: { boardId: membershipBoard.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const retainedOwnerCard = await prisma.card.create({
      data: {
        boardId: membershipBoard.id,
        columnId: membershipBoardColumn.id,
        column: "WENT_WELL",
        text: "Карточка прежнего владельца",
        createdByMembershipId: prunableOwnerMembership.id,
        position: 1024,
      },
    });
    await prisma.anonymousSession.update({
      where: { id: membershipOwner.sessionId },
      data: { revokedAt: new Date() },
    });
    const membershipRecoveryClaim = await createLegacyOwnerClaimInvitation(membershipBoard.id);
    assert.equal(
      (await redeemBoardInvitation(membershipRecoveryClaim.token, membershipRecoveryPayload)).role,
      "OWNER",
    );
    assert.equal(
      await prisma.boardMembership.count({
        where: { boardId: membershipBoard.id, role: "OWNER" },
      }),
      MAX_BOARD_OWNER_HISTORY_RECORDS,
    );
    assert.equal(
      await prisma.boardMembership.count({ where: { id: prunableOwnerMembership.id } }),
      0,
    );
    assert.equal(
      (await prisma.card.findUniqueOrThrow({
        where: { id: retainedOwnerCard.id },
        select: { createdByMembershipId: true },
      })).createdByMembershipId,
      null,
    );
  } finally {
    await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: payloads.map((payload) => deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

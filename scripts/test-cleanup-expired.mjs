import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

if (process.env.TEST_DATABASE_IS_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_IS_DISPOSABLE=1 only for an isolated PostgreSQL test database",
  );
}

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const credentialHash = () => randomBytes(32).toString("base64url");
const bucketKey = () => randomBytes(32).toString("hex");
const now = new Date();
const beforeNow = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
const expiredAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const future = new Date(now.getTime() + 24 * 60 * 60 * 1000);

const ids = {
  boards: [],
  sessions: [],
  buckets: [],
};

try {
  const expiredOwner = await prisma.anonymousSession.create({
    data: {
      credentialHash: credentialHash(),
      createdAt: beforeNow,
      expiresAt: expiredAt,
    },
  });
  const expiredParticipant = await prisma.anonymousSession.create({
    data: {
      credentialHash: credentialHash(),
      createdAt: beforeNow,
      expiresAt: expiredAt,
    },
  });
  const expiredRevoked = await prisma.anonymousSession.create({
    data: {
      credentialHash: credentialHash(),
      createdAt: beforeNow,
      expiresAt: expiredAt,
      revokedAt: expiredAt,
    },
  });
  const futureRevoked = await prisma.anonymousSession.create({
    data: {
      credentialHash: credentialHash(),
      createdAt: beforeNow,
      expiresAt: future,
      revokedAt: expiredAt,
    },
  });
  const activeOwner = await prisma.anonymousSession.create({
    data: {
      credentialHash: credentialHash(),
      createdAt: beforeNow,
      expiresAt: future,
    },
  });
  ids.sessions.push(
    expiredOwner.id,
    expiredParticipant.id,
    expiredRevoked.id,
    futureRevoked.id,
    activeOwner.id,
  );

  const expiredBoard = await prisma.board.create({
    data: {
      title: "Expired cleanup board",
      createdAt: beforeNow,
      expiresAt: expiredAt,
    },
  });
  const activeBoard = await prisma.board.create({
    data: {
      title: "Active cleanup board",
      createdAt: beforeNow,
      expiresAt: future,
    },
  });
  ids.boards.push(expiredBoard.id, activeBoard.id);
  const expiredColumn = await prisma.boardColumn.create({
    data: {
      boardId: expiredBoard.id,
      title: "Expired feedback",
      position: 1024,
      voteLimit: 3,
    },
  });
  const activeColumn = await prisma.boardColumn.create({
    data: {
      boardId: activeBoard.id,
      title: "Active feedback",
      position: 1024,
      voteLimit: 3,
    },
  });

  const expiredOwnerMembership = await prisma.boardMembership.create({
    data: {
      boardId: expiredBoard.id,
      sessionId: expiredOwner.id,
      role: "OWNER",
      displayName: "Cleanup owner",
      createdAt: beforeNow,
    },
  });
  const expiredParticipantMembership = await prisma.boardMembership.create({
    data: {
      boardId: expiredBoard.id,
      sessionId: expiredParticipant.id,
      role: "PARTICIPANT",
      displayName: "Cleanup participant",
      createdAt: beforeNow,
    },
  });
  const invitation = await prisma.boardInvitation.create({
    data: {
      boardId: expiredBoard.id,
      tokenHash: credentialHash(),
      role: "PARTICIPANT",
      createdBySessionId: expiredOwner.id,
      createdAt: beforeNow,
      expiresAt: expiredAt,
      maxUses: 1,
      useCount: 1,
    },
  });
  await prisma.invitationRedemption.create({
    data: {
      invitationId: invitation.id,
      membershipId: expiredParticipantMembership.id,
      boardId: expiredBoard.id,
      sessionId: expiredParticipant.id,
      createdAt: beforeNow,
    },
  });
  const expiredCard = await prisma.card.create({
    data: {
      boardId: expiredBoard.id,
      columnId: expiredColumn.id,
      column: "WENT_WELL",
      text: "Expired",
      createdByMembershipId: expiredOwnerMembership.id,
      position: 1024,
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
  });
  await prisma.vote.createMany({
    data: Array.from({ length: 10_001 }, (_, index) => ({
      boardId: expiredBoard.id,
      cardId: expiredCard.id,
      columnId: expiredColumn.id,
      column: "WENT_WELL",
      visitorToken: `cleanup-legacy-voter-${index}`,
      quotaSlot: 1,
    })),
  });
  const expiredGroupCards = await Promise.all([
    prisma.card.create({
      data: {
        boardId: expiredBoard.id,
        columnId: expiredColumn.id,
        column: "WENT_WELL",
        text: "Expired group primary",
        createdByMembershipId: expiredOwnerMembership.id,
        position: 2048,
        createdAt: beforeNow,
        updatedAt: beforeNow,
      },
    }),
    prisma.card.create({
      data: {
        boardId: expiredBoard.id,
        columnId: expiredColumn.id,
        column: "WENT_WELL",
        text: "Expired group secondary",
        createdByMembershipId: expiredParticipantMembership.id,
        position: 3072,
        createdAt: beforeNow,
        updatedAt: beforeNow,
      },
    }),
  ]);
  const expiredGroup = await prisma.cardGroup.create({
    data: {
      boardId: expiredBoard.id,
      columnId: expiredColumn.id,
      position: 2048,
      primaryCardId: expiredGroupCards[0].id,
      title: "Expired group",
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
  });
  await prisma.$transaction([
    prisma.card.update({
      where: { id: expiredGroupCards[0].id },
      data: { groupId: expiredGroup.id, groupPosition: 1024 },
    }),
    prisma.card.update({
      where: { id: expiredGroupCards[1].id },
      data: { groupId: expiredGroup.id, groupPosition: 2048 },
    }),
  ]);
  await prisma.actionItem.create({
    data: {
      boardId: expiredBoard.id,
      text: "Expired action item",
      assignee: "Cleanup owner",
      position: 1024,
      sourceCardId: expiredGroupCards[0].id,
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
  });

  const activeOwnerMembership = await prisma.boardMembership.create({
    data: {
      boardId: activeBoard.id,
      sessionId: activeOwner.id,
      role: "OWNER",
      displayName: "Active owner",
      createdAt: beforeNow,
    },
  });
  const activeCard = await prisma.card.create({
    data: {
      boardId: activeBoard.id,
      columnId: activeColumn.id,
      column: "WENT_WELL",
      text: "Active",
      createdByMembershipId: activeOwnerMembership.id,
      position: 1024,
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
  });
  const activeGroupedCard = await prisma.card.create({
    data: {
      boardId: activeBoard.id,
      columnId: activeColumn.id,
      column: "WENT_WELL",
      text: "Active grouped card",
      position: 2048,
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
  });
  const activeGroup = await prisma.cardGroup.create({
    data: {
      boardId: activeBoard.id,
      columnId: activeColumn.id,
      position: 1024,
      primaryCardId: activeCard.id,
      title: "Active group",
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
  });
  await prisma.$transaction([
    prisma.card.update({
      where: { id: activeCard.id },
      data: { groupId: activeGroup.id, groupPosition: 1024 },
    }),
    prisma.card.update({
      where: { id: activeGroupedCard.id },
      data: { groupId: activeGroup.id, groupPosition: 2048 },
    }),
  ]);
  await prisma.actionItem.create({
    data: {
      boardId: activeBoard.id,
      text: "Active action item",
      position: 1024,
      sourceCardId: activeCard.id,
      createdAt: beforeNow,
      updatedAt: beforeNow,
    },
  });
  await prisma.vote.create({
    data: {
      boardId: activeBoard.id,
      cardId: activeCard.id,
      columnId: activeColumn.id,
      column: "WENT_WELL",
      visitorToken: "cleanup-active-voter",
      quotaSlot: 1,
    },
  });

  const expiredBucketKey = bucketKey();
  const activeBucketKey = bucketKey();
  ids.buckets.push(expiredBucketKey, activeBucketKey);
  await prisma.rateLimitBucket.createMany({
    data: [
      { key: expiredBucketKey, count: 1, resetAt: expiredAt },
      { key: activeBucketKey, count: 1, resetAt: future },
    ],
  });

  const { stdout } = await execFileAsync(
    process.execPath,
    ["scripts/cleanup-expired.mjs", "100"],
    { env: process.env },
  );
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  assert.equal(result.advisoryLockAcquired, true);
  assert.equal(result.skipReason, null);
  assert.equal(result.aborted, false);
  assert.equal(result.boardDeleteFailures, 0);
  assert.equal(result.boardCandidatesDeferred, 0);
  assert.ok(result.boardCleanupChunks >= 2);

  const [expiredCounts, activeCounts] = await Promise.all([
    Promise.all([
      prisma.board.count({ where: { id: expiredBoard.id } }),
      prisma.boardColumn.count({ where: { boardId: expiredBoard.id } }),
      prisma.card.count({ where: { boardId: expiredBoard.id } }),
      prisma.vote.count({ where: { boardId: expiredBoard.id } }),
      prisma.cardGroup.count({ where: { boardId: expiredBoard.id } }),
      prisma.actionItem.count({ where: { boardId: expiredBoard.id } }),
      prisma.boardMembership.count({ where: { boardId: expiredBoard.id } }),
      prisma.boardInvitation.count({ where: { boardId: expiredBoard.id } }),
      prisma.invitationRedemption.count({
        where: { boardId: expiredBoard.id },
      }),
      prisma.anonymousSession.count({
        where: {
          id: {
            in: [expiredOwner.id, expiredParticipant.id, expiredRevoked.id],
          },
        },
      }),
      prisma.rateLimitBucket.count({ where: { key: expiredBucketKey } }),
    ]),
    Promise.all([
      prisma.board.count({ where: { id: activeBoard.id } }),
      prisma.boardColumn.count({ where: { boardId: activeBoard.id } }),
      prisma.card.count({ where: { boardId: activeBoard.id } }),
      prisma.vote.count({ where: { cardId: activeCard.id } }),
      prisma.cardGroup.count({ where: { boardId: activeBoard.id } }),
      prisma.actionItem.count({ where: { boardId: activeBoard.id } }),
      prisma.anonymousSession.count({
        where: { id: { in: [futureRevoked.id, activeOwner.id] } },
      }),
      prisma.rateLimitBucket.count({ where: { key: activeBucketKey } }),
    ]),
  ]);

  assert.deepEqual(expiredCounts, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(activeCounts, [1, 1, 2, 1, 1, 1, 2, 1]);
  assert.ok(expiredOwnerMembership.id);
  console.log("cleanup integration passed");
} finally {
  await prisma.board.deleteMany({ where: { id: { in: ids.boards } } });
  await prisma.anonymousSession.deleteMany({
    where: { id: { in: ids.sessions } },
  });
  await prisma.rateLimitBucket.deleteMany({
    where: { key: { in: ids.buckets } },
  });
  await prisma.$disconnect();
}

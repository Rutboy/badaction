import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createParticipantInvitation,
  redeemBoardInvitation,
} from "../access/acl-service.ts";
import { deriveSessionCredentialHash } from "../access/session-service.ts";
import { deriveBoardVisitorId } from "../cookies/visitor-token-core.ts";
import {
  MAX_ACTIVE_OWNED_BOARDS_PER_SESSION,
  MAX_BOARD_TOTAL_VOTE_RECORDS,
} from "../constants/access.ts";
import { uuidParamSchema } from "../validators/common.ts";
import { ApiError } from "../errors/api-error-base.ts";
import { prisma } from "../prisma/client.ts";
import {
  createBoard,
  createCard,
  getBoard,
  getCardPage,
  getExportRows,
  likeCard,
} from "./boards-service.ts";

const databaseTest = process.env.RUN_DATABASE_TESTS === "1" ? test : test.skip;

const isApiErrorWithCode = (code) => (error) =>
  error instanceof ApiError && error.code === code;
const createVisitorPayload = () => randomBytes(32).toString("base64url");
const getLegacyFeedbackColumns = async (boardId) => {
  const columns = await prisma.boardColumn.findMany({
    where: { boardId },
    orderBy: [{ position: "asc" }, { id: "asc" }],
    select: { id: true, title: true, position: true, voteLimit: true },
  });
  assert.equal(columns.length, 2);
  return {
    WENT_WELL: columns[0],
    TO_IMPROVE: columns[1],
  };
};

databaseTest("service preserves vote, duplicate, card quota, and expiry invariants", async () => {
  const boardIds = [];
  const visitorPayloads = [];
  const previousCardLimit = process.env.BOARD_CARD_LIMIT;

  try {
    process.env.BOARD_CARD_LIMIT = "10";

    const voteOwner = createVisitorPayload();
    visitorPayloads.push(voteOwner);
    const voteBoard = await createBoard(voteOwner);
    boardIds.push(voteBoard.id);
    const storedVoteBoard = await prisma.board.findUniqueOrThrow({
      where: { id: voteBoard.id },
      select: { title: true, revision: true },
    });
    assert.equal(storedVoteBoard.title, `Retrospective ${voteBoard.id.slice(0, 8)}`);
    assert.equal(storedVoteBoard.revision, 0n);
    const voteColumns = await getLegacyFeedbackColumns(voteBoard.id);
    assert.deepEqual(
      [voteColumns.WENT_WELL, voteColumns.TO_IMPROVE].map((column) => ({
        title: column.title,
        position: column.position,
        voteLimit: column.voteLimit,
      })),
      [
        { title: "Уже хорошо", position: 1024, voteLimit: 3 },
        { title: "Следует улучшить", position: 2048, voteLimit: 3 },
      ],
    );

    const cards = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        createCard(voteBoard.id, voteOwner, {
          column: "WENT_WELL",
          text: `Concurrency card ${index}`,
        }),
      ),
    );
    assert.equal(
      await prisma.card.count({
        where: {
          id: { in: cards.map((card) => card.id) },
          column: null,
          owner: null,
          columnId: voteColumns.WENT_WELL.id,
        },
      }),
      cards.length,
    );

    const action = await createCard(voteBoard.id, voteOwner, {
      column: "ACTIONS",
      text: "  Target action  ",
      owner: "  Ответственный  ",
    });
    assert.deepEqual(
      {
        column: action.column,
        text: action.text,
        owner: action.owner,
        likesCount: action.likesCount,
      },
      {
        column: "ACTIONS",
        text: "Target action",
        owner: "Ответственный",
        likesCount: 0,
      },
    );
    assert.equal(await prisma.card.findUnique({ where: { id: action.id } }), null);
    assert.equal(
      (await prisma.actionItem.findUniqueOrThrow({ where: { id: action.id } })).boardId,
      voteBoard.id,
    );
    await assert.rejects(
      () => likeCard(voteBoard.id, action.id, voteOwner, `action-${randomUUID()}`),
      isApiErrorWithCode("LIKES_NOT_ALLOWED"),
    );

    const quotaVisitor = deriveBoardVisitorId(
      voteOwner,
      voteBoard.id,
      "integration-test-vote-identity-secret",
    );
    assert.equal(
      quotaVisitor,
      deriveBoardVisitorId(
        voteOwner,
        voteBoard.id.toUpperCase(),
        "integration-test-vote-identity-secret",
      ),
    );
    const quotaResults = await Promise.allSettled(
      cards.slice(0, 4).map((card, index) => {
        const routeBoardId = uuidParamSchema.parse(
          index % 2 === 0 ? voteBoard.id : voteBoard.id.toUpperCase(),
        );
        return likeCard(
          routeBoardId,
          card.id,
          voteOwner,
          deriveBoardVisitorId(
            voteOwner,
            routeBoardId,
            "integration-test-vote-identity-secret",
          ),
        );
      }),
    );

    const quotaFailures = quotaResults.filter((result) => result.status === "rejected");
    assert.equal(
      quotaResults.filter((result) => result.status === "fulfilled").length,
      3,
      quotaFailures.map((result) => `${result.reason?.code}: ${result.reason?.message}`).join("\n"),
    );
    assert.equal(quotaFailures.length, 1);
    assert.equal(
      isApiErrorWithCode("COLUMN_VOTE_LIMIT_REACHED")(quotaFailures[0].reason),
      true,
    );
    assert.equal(
      await prisma.vote.count({
        where: {
          boardId: voteBoard.id,
          columnId: voteColumns.WENT_WELL.id,
          visitorToken: quotaVisitor,
        },
      }),
      3,
    );
    assert.deepEqual(
      (
        await prisma.vote.findMany({
          where: {
            boardId: voteBoard.id,
            columnId: voteColumns.WENT_WELL.id,
            visitorToken: quotaVisitor,
          },
          orderBy: { quotaSlot: "asc" },
          select: { quotaSlot: true },
        })
      ).map((vote) => vote.quotaSlot),
      [1, 2, 3],
    );

    const directVisitor = `direct-${randomUUID()}`;
    const directQuotaResults = await Promise.allSettled(
      cards.slice(0, 4).map((card, index) =>
        prisma.vote.create({
          data: {
            boardId: voteBoard.id,
            cardId: card.id,
            columnId: voteColumns.WENT_WELL.id,
            visitorToken: directVisitor,
            quotaSlot: (index % 3) + 1,
          },
        }),
      ),
    );

    assert.equal(directQuotaResults.filter((result) => result.status === "fulfilled").length, 3);
    const directQuotaFailures = directQuotaResults.filter((result) => result.status === "rejected");
    assert.equal(directQuotaFailures.length, 1);
    assert.equal(directQuotaFailures[0].reason?.code, "P2002");
    assert.equal(
      await prisma.vote.count({
        where: {
          boardId: voteBoard.id,
          columnId: voteColumns.WENT_WELL.id,
          visitorToken: directVisitor,
        },
      }),
      3,
    );

    const duplicateVisitor = `duplicate-${randomUUID()}`;
    const duplicateResults = await Promise.allSettled([
      likeCard(voteBoard.id, cards[4].id, voteOwner, duplicateVisitor),
      likeCard(voteBoard.id, cards[4].id, voteOwner, duplicateVisitor),
    ]);

    assert.equal(duplicateResults.filter((result) => result.status === "fulfilled").length, 1);
    const duplicateFailures = duplicateResults.filter((result) => result.status === "rejected");
    assert.equal(duplicateFailures.length, 1);
    assert.equal(isApiErrorWithCode("LIKE_ALREADY_EXISTS")(duplicateFailures[0].reason), true);
    assert.equal(
      await prisma.vote.count({
        where: {
          cardId: cards[4].id,
          visitorToken: duplicateVisitor,
        },
      }),
      1,
    );
    assert.equal(
      await prisma.vote.count({
        where: { boardId: voteBoard.id, column: null },
      }),
      7,
    );
    assert.equal(
      (await prisma.board.findUniqueOrThrow({ where: { id: voteBoard.id } })).revision,
      10n,
    );

    process.env.BOARD_CARD_LIMIT = "2";

    const limitedOwner = createVisitorPayload();
    const limitedParticipant = createVisitorPayload();
    visitorPayloads.push(limitedOwner, limitedParticipant);
    const limitedBoard = await createBoard(limitedOwner);
    boardIds.push(limitedBoard.id);
    const limitedColumns = await getLegacyFeedbackColumns(limitedBoard.id);
    const invitation = await createParticipantInvitation(limitedBoard.id, limitedOwner);
    const participantMembership = await redeemBoardInvitation(
      invitation.token,
      limitedParticipant,
      "Участник",
    );
    const participantAction = await createCard(limitedBoard.id, limitedParticipant, {
      column: "ACTIONS",
      text: "  Participant action  ",
      owner: "  Исполнитель  ",
    });
    assert.deepEqual(
      {
        column: participantAction.column,
        text: participantAction.text,
        owner: participantAction.owner,
      },
      {
        column: "ACTIONS",
        text: "Participant action",
        owner: "Исполнитель",
      },
    );
    const cardResults = await Promise.allSettled([
      createCard(limitedBoard.id, limitedParticipant, {
        column: "TO_IMPROVE",
        text: "Quota card 1",
      }),
      createCard(limitedBoard.id, limitedParticipant, {
        column: "TO_IMPROVE",
        text: "Quota card 2",
      }),
    ]);

    assert.equal(cardResults.filter((result) => result.status === "fulfilled").length, 1);
    const cardFailures = cardResults.filter((result) => result.status === "rejected");
    assert.equal(cardFailures.length, 1);
    assert.equal(isApiErrorWithCode("BOARD_CARD_LIMIT_REACHED")(cardFailures[0].reason), true);
    const fulfilledCard = cardResults.find((result) => result.status === "fulfilled").value;
    const storedCard = await prisma.card.findUniqueOrThrow({
      where: { id: fulfilledCard.id },
    });
    assert.deepEqual(
      {
        columnId: storedCard.columnId,
        column: storedCard.column,
        owner: storedCard.owner,
        author: storedCard.author,
        createdByMembershipId: storedCard.createdByMembershipId,
        position: storedCard.position,
      },
      {
        columnId: limitedColumns.TO_IMPROVE.id,
        column: null,
        owner: null,
        author: null,
        createdByMembershipId: participantMembership.membershipId,
        position: 1024,
      },
    );
    assert.equal(await prisma.card.count({ where: { boardId: limitedBoard.id } }), 1);
    assert.equal(await prisma.actionItem.count({ where: { boardId: limitedBoard.id } }), 1);
    assert.equal(await prisma.card.findUnique({ where: { id: participantAction.id } }), null);
    assert.deepEqual(
      await prisma.actionItem.findUniqueOrThrow({
        where: { id: participantAction.id },
        select: {
          boardId: true,
          text: true,
          assignee: true,
          completed: true,
          position: true,
          sourceCardId: true,
        },
      }),
      {
        boardId: limitedBoard.id,
        text: "Participant action",
        assignee: "Исполнитель",
        completed: false,
        position: 1024,
        sourceCardId: null,
      },
    );
    assert.equal(
      (await prisma.board.findUniqueOrThrow({ where: { id: limitedBoard.id } })).revision,
      2n,
    );

    const now = Date.now();
    const expiredOwner = createVisitorPayload();
    visitorPayloads.push(expiredOwner);
    const expiredBoard = await createBoard(expiredOwner);
    const expiredColumns = await getLegacyFeedbackColumns(expiredBoard.id);
    await prisma.board.update({
      where: { id: expiredBoard.id },
      data: {
        createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(now - 24 * 60 * 60 * 1000),
      },
    });
    boardIds.push(expiredBoard.id);
    const expiredCard = await prisma.card.create({
      data: {
        boardId: expiredBoard.id,
        columnId: expiredColumns.WENT_WELL.id,
        position: 1024,
        text: "Expired card",
      },
    });

    await assert.rejects(
      () => getBoard(expiredBoard.id, expiredOwner),
      isApiErrorWithCode("BOARD_NOT_FOUND"),
    );
    await assert.rejects(
      () => getExportRows(expiredBoard.id, expiredOwner),
      isApiErrorWithCode("BOARD_NOT_FOUND"),
    );
    await assert.rejects(
      () => createCard(
        expiredBoard.id,
        expiredOwner,
        { column: "ACTIONS", text: "Expired", owner: "Test" },
      ),
      isApiErrorWithCode("BOARD_NOT_FOUND"),
    );
    await assert.rejects(
      () => likeCard(
        expiredBoard.id,
        expiredCard.id,
        expiredOwner,
        `expired-${randomUUID()}`,
      ),
      isApiErrorWithCode("BOARD_NOT_FOUND"),
    );
  } finally {
    if (previousCardLimit === undefined) {
      delete process.env.BOARD_CARD_LIMIT;
    } else {
      process.env.BOARD_CARD_LIMIT = previousCardLimit;
    }

    await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: visitorPayloads.map((payload) => deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

databaseTest("active owned-board quota remains atomic under concurrent creates", async () => {
  const visitorPayload = createVisitorPayload();
  const boardIds = [];

  try {
    const firstBoard = await createBoard(visitorPayload);
    boardIds.push(firstBoard.id);
    const session = await prisma.anonymousSession.findUniqueOrThrow({
      where: { credentialHash: deriveSessionCredentialHash(visitorPayload) },
      select: { id: true },
    });
    const seededBoardIds = Array.from(
      { length: MAX_ACTIVE_OWNED_BOARDS_PER_SESSION - 2 },
      () => randomUUID(),
    );
    boardIds.push(...seededBoardIds);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.board.createMany({
      data: seededBoardIds.map((id) => ({
        id,
        title: `Ретроспектива ${id.slice(0, 8)}`,
        expiresAt,
      })),
    });
    await prisma.boardMembership.createMany({
      data: seededBoardIds.map((boardId) => ({
        boardId,
        sessionId: session.id,
        role: "OWNER",
        displayName: "Владелец",
      })),
    });

    const competingCreates = await Promise.allSettled([
      createBoard(visitorPayload),
      createBoard(visitorPayload),
    ]);
    const created = competingCreates.filter((result) => result.status === "fulfilled");
    const rejected = competingCreates.filter((result) => result.status === "rejected");
    assert.equal(created.length, 1);
    assert.equal(rejected.length, 1);
    boardIds.push(created[0].value.id);
    assert.equal(isApiErrorWithCode("SESSION_BOARD_LIMIT_REACHED")(rejected[0].reason), true);
    assert.equal(
      await prisma.boardMembership.count({
        where: {
          sessionId: session.id,
          role: "OWNER",
          revokedAt: null,
          board: { expiresAt: { gt: new Date() } },
        },
      }),
      MAX_ACTIVE_OWNED_BOARDS_PER_SESSION,
    );
    await assert.rejects(
      () => createBoard(visitorPayload),
      isApiErrorWithCode("SESSION_BOARD_LIMIT_REACHED"),
    );
  } finally {
    await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
    await prisma.anonymousSession.deleteMany({
      where: { credentialHash: deriveSessionCredentialHash(visitorPayload) },
    });
  }
});

databaseTest("card pages keep stable order and isolate cursors by board and column", async () => {
  const boardIds = [];
  const visitorPayloads = [];

  try {
    const boardOwner = createVisitorPayload();
    const otherBoardOwner = createVisitorPayload();
    visitorPayloads.push(boardOwner, otherBoardOwner);
    const board = await createBoard(boardOwner);
    const otherBoard = await createBoard(otherBoardOwner);
    boardIds.push(board.id, otherBoard.id);
    const boardColumns = await getLegacyFeedbackColumns(board.id);
    const otherBoardColumns = await getLegacyFeedbackColumns(otherBoard.id);

    const baseTime = Date.now() - 60_000;
    const cardsByColumn = {
      WENT_WELL: Array.from({ length: 6 }, (_, index) => ({
        id: randomUUID(),
        boardId: board.id,
        columnId: boardColumns.WENT_WELL.id,
        position: (index + 1) * 1024,
        text: `Went well ${index}`,
        createdAt: new Date(baseTime - Math.floor(index / 2) * 1000),
      })),
      TO_IMPROVE: Array.from({ length: 4 }, (_, index) => ({
        id: randomUUID(),
        boardId: board.id,
        columnId: boardColumns.TO_IMPROVE.id,
        position: (index + 1) * 1024,
        text: `Improve ${index}`,
        createdAt: new Date(baseTime - Math.floor(index / 2) * 1000),
      })),
      ACTIONS: Array.from({ length: 3 }, (_, index) => ({
        id: randomUUID(),
        boardId: board.id,
        text: `Action ${index}`,
        assignee: `Owner ${index}`,
        position: (index + 1) * 1024,
        createdAt: new Date(baseTime - Math.floor(index / 2) * 1000),
      })),
    };
    const compareExpectedCards = (left, right) =>
      right.createdAt.getTime() - left.createdAt.getTime()
      || (left.id < right.id ? 1 : -1);
    const orderedByColumn = Object.fromEntries(
      Object.entries(cardsByColumn).map(([column, cards]) => [
        column,
        [...cards].sort(compareExpectedCards),
      ]),
    );

    await prisma.card.createMany({
      data: [...cardsByColumn.WENT_WELL, ...cardsByColumn.TO_IMPROVE],
    });
    await prisma.actionItem.createMany({ data: cardsByColumn.ACTIONS });
    const foreignCursorCard = await prisma.card.create({
      data: {
        boardId: otherBoard.id,
        columnId: otherBoardColumns.WENT_WELL.id,
        position: 1024,
        text: "Foreign cursor",
      },
    });

    const firstBoardPage = await getBoard(board.id, boardOwner, 2);
    for (const column of firstBoardPage.columns) {
      const expectedCards = orderedByColumn[column.key];
      assert.deepEqual(column.cards.map((card) => card.id), expectedCards.slice(0, 2).map((card) => card.id));
      assert.equal(column.totalCount, expectedCards.length);
      assert.equal(column.nextCursor, expectedCards.length > 2 ? expectedCards[1].id : null);
    }

    const wentWellFirstPage = firstBoardPage.columns.find((column) => column.key === "WENT_WELL");
    assert.ok(wentWellFirstPage);
    assert.ok(wentWellFirstPage.nextCursor);
    const wentWellSecondPage = await getCardPage(
      board.id,
      boardOwner,
      "WENT_WELL",
      wentWellFirstPage.nextCursor,
      2,
    );
    assert.ok(wentWellSecondPage.nextCursor);
    const wentWellThirdPage = await getCardPage(
      board.id,
      boardOwner,
      "WENT_WELL",
      wentWellSecondPage.nextCursor,
      2,
    );
    const expectedWentWellCards = orderedByColumn.WENT_WELL;

    assert.deepEqual(
      [
        ...wentWellFirstPage.cards,
        ...wentWellSecondPage.cards,
        ...wentWellThirdPage.cards,
      ].map((card) => card.id),
      expectedWentWellCards.map((card) => card.id),
    );
    assert.equal(wentWellSecondPage.totalCount, expectedWentWellCards.length);
    assert.equal(wentWellSecondPage.nextCursor, expectedWentWellCards[3].id);
    assert.equal(wentWellThirdPage.nextCursor, null);

    const improveCursor = firstBoardPage.columns.find(
      (column) => column.key === "TO_IMPROVE",
    )?.nextCursor;
    assert.ok(improveCursor);
    await assert.rejects(
      () => getCardPage(board.id, boardOwner, "WENT_WELL", improveCursor, 2),
      isApiErrorWithCode("INVALID_CURSOR"),
    );
    await assert.rejects(
      () => getCardPage(board.id, boardOwner, "WENT_WELL", foreignCursorCard.id, 2),
      isApiErrorWithCode("INVALID_CURSOR"),
    );
    await assert.rejects(() => getBoard(board.id, boardOwner, 0), /limit must be an integer/);
    await assert.rejects(
      () => getCardPage(board.id, boardOwner, "WENT_WELL", undefined, 101),
      /limit must be an integer/,
    );
    const exportRows = await getExportRows(board.id, boardOwner);
    assert.equal(exportRows.length, 13);
    assert.equal(exportRows.every((row) => row.column !== null), true);
    assert.deepEqual(
      exportRows
        .filter((row) => row.column === "ACTIONS")
        .map((row) => row.owner)
        .sort(),
      ["Owner 0", "Owner 1", "Owner 2"],
    );
    await assert.rejects(
      () => getExportRows(board.id, boardOwner, { BOARD_CARD_LIMIT: "12" }),
      isApiErrorWithCode("BOARD_EXPORT_LIMIT_EXCEEDED"),
    );

    await prisma.vote.createMany({
      data: Array.from({ length: MAX_BOARD_TOTAL_VOTE_RECORDS + 1 }, (_, index) => ({
        boardId: board.id,
        cardId: expectedWentWellCards[0].id,
        columnId: boardColumns.WENT_WELL.id,
        visitorToken: `legacy-export-voter-${index}`,
        quotaSlot: 1,
      })),
    });
    await assert.rejects(
      () => getExportRows(board.id, boardOwner),
      isApiErrorWithCode("BOARD_EXPORT_LIMIT_EXCEEDED"),
    );
  } finally {
    await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
    await prisma.anonymousSession.deleteMany({
      where: {
        credentialHash: {
          in: visitorPayloads.map((payload) => deriveSessionCredentialHash(payload)),
        },
      },
    });
  }
});

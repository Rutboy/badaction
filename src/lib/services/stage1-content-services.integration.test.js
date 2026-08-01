import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createParticipantInvitation,
  redeemBoardInvitation,
  revokeBoardParticipant,
} from "../access/acl-service.ts";
import { deriveSessionCredentialHash } from "../access/session-service.ts";
import { prisma } from "../prisma/client.ts";
import {
  createActionItem,
  moveActionItem,
  updateActionItem,
} from "./action-items-service.ts";
import {
  createTargetBoard,
  DEFAULT_BOARD_COLUMNS,
  updateBoardSettings,
} from "./board-settings-service.ts";
import {
  createTargetCard,
  likeCardLegacyAdapter,
  moveTargetCard,
  removeVoteFromCard,
  resetBoardVotes,
  updateTargetCard,
  voteForCard,
} from "./cards-votes-service.ts";
import {
  createBoardColumn,
  moveBoardColumn,
  updateBoardColumn,
} from "./columns-service.ts";
import {
  MAX_BOARD_ACTION_ITEMS,
  deriveContentVisitorIdentity,
} from "./content-service-helpers.ts";
import {
  createCardGroup,
  moveCardGroup,
  ungroupCardGroup,
  updateCardGroup,
} from "./groups-service.ts";

const databaseTest = process.env.RUN_DATABASE_TESTS === "1" ? test : test.skip;
const createVisitorPayload = () => randomBytes(32).toString("base64url");
const createVisitorIdentity = (boardId, visitorPayload) =>
  deriveContentVisitorIdentity(boardId, visitorPayload);

const hasCode = (code) => (error) => {
  assert.equal(error?.code, code);
  return true;
};

const getBoardRevision = async (boardId) => (
  await prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { revision: true } })
).revision;

const assertMutationRevision = async (boardId, before, result, delta = 1n) => {
  const expected = before + delta;
  assert.equal(result.revision, expected.toString());
  assert.equal(await getBoardRevision(boardId), expected);
  return expected;
};

const cleanupFixture = async ({ boardIds, visitorPayloads }) => {
  await prisma.board.deleteMany({ where: { id: { in: boardIds } } });
  await prisma.anonymousSession.deleteMany({
    where: {
      credentialHash: {
        in: visitorPayloads.map((payload) => deriveSessionCredentialHash(payload)),
      },
    },
  });
};

databaseTest("board creation localizes only new default columns and does not persist locale", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const ownerPayload = createVisitorPayload();
  fixture.visitorPayloads.push(ownerPayload);

  const cases = [
    { title: "English defaults", locale: "en", expected: ["Went well", "Could improve"] },
    {
      title: "Russian defaults",
      locale: "ru",
      expected: ["Что прошло хорошо", "Что можно улучшить"],
    },
    { title: "Spanish defaults", locale: "es", expected: ["Salió bien", "Se puede mejorar"] },
    { title: "Invalid locale fallback", locale: "de", expected: ["Went well", "Could improve"] },
    { title: "Omitted locale fallback", expected: ["Went well", "Could improve"] },
  ];

  try {
    for (const localeCase of cases) {
      const board = localeCase.locale === undefined
        ? await createTargetBoard(ownerPayload, localeCase.title)
        : await createTargetBoard(ownerPayload, localeCase.title, localeCase.locale);
      fixture.boardIds.push(board.id);

      const persisted = await prisma.board.findUniqueOrThrow({
        where: { id: board.id },
        include: { columns: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
      });
      assert.equal(Object.hasOwn(persisted, "locale"), false);
      assert.equal(persisted.revision, 0n);
      assert.deepEqual(
        persisted.columns.map(({ title, position, voteLimit }) => ({
          title,
          position,
          voteLimit,
        })),
        localeCase.expected.map((title, index) => ({
          title,
          position: (index + 1) * 1024,
          voteLimit: 3,
        })),
      );
    }

    const russianBoardId = fixture.boardIds[1];
    const russianBoardAfterOtherLocaleCreates = await prisma.board.findUniqueOrThrow({
      where: { id: russianBoardId },
      include: { columns: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
    });
    assert.equal(russianBoardAfterOtherLocaleCreates.revision, 0n);
    assert.deepEqual(
      russianBoardAfterOtherLocaleCreates.columns.map((column) => column.title),
      ["Что прошло хорошо", "Что можно улучшить"],
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("target board creation, settings modes, and dynamic columns preserve revision semantics", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const ownerPayload = createVisitorPayload();
  fixture.visitorPayloads.push(ownerPayload);

  try {
    const board = await createTargetBoard(ownerPayload, "  Этап 1  ");
    fixture.boardIds.push(board.id);
    assert.equal(board.title, "Этап 1");
    assert.equal(board.revision, "0");

    const persisted = await prisma.board.findUniqueOrThrow({
      where: { id: board.id },
      include: {
        columns: { orderBy: [{ position: "asc" }, { id: "asc" }] },
        memberships: { where: { revokedAt: null } },
      },
    });
    assert.equal(persisted.revision, 0n);
    assert.deepEqual(
      persisted.columns.map(({ title, position, voteLimit }) => ({ title, position, voteLimit })),
      DEFAULT_BOARD_COLUMNS.map((column) => ({ ...column })),
    );
    assert.equal(persisted.memberships.length, 1);
    assert.equal(persisted.memberships[0].role, "OWNER");
    assert.equal(
      await prisma.anonymousSession.count({
        where: { credentialHash: deriveSessionCredentialHash(ownerPayload) },
      }),
      1,
    );

    let revision = await getBoardRevision(board.id);
    const noOpSettings = await updateBoardSettings(board.id, ownerPayload, {
      title: " Этап 1 ",
    });
    revision = await assertMutationRevision(board.id, revision, noOpSettings, 0n);

    const disabledSettings = await updateBoardSettings(board.id, ownerPayload, {
      cardsEnabled: false,
      votingEnabled: false,
    });
    revision = await assertMutationRevision(board.id, revision, disabledSettings);
    const columns = await prisma.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    await assert.rejects(
      () => createTargetCard(board.id, ownerPayload, {
        columnId: columns[0].id,
        text: "Не создаётся",
      }),
      hasCode("CARDS_DISABLED"),
    );
    assert.equal(await getBoardRevision(board.id), revision);

    const cardsEnabled = await updateBoardSettings(board.id, ownerPayload, {
      cardsEnabled: true,
    });
    revision = await assertMutationRevision(board.id, revision, cardsEnabled);
    const createdCard = await createTargetCard(board.id, ownerPayload, {
      columnId: columns[0].id,
      text: "Карточка для режимов",
    });
    revision = await assertMutationRevision(board.id, revision, createdCard);
    await assert.rejects(
      () => voteForCard(
        board.id,
        createdCard.card.id,
        ownerPayload,
        createVisitorIdentity(board.id, ownerPayload),
      ),
      hasCode("VOTING_DISABLED"),
    );
    assert.equal(await getBoardRevision(board.id), revision);

    const readOnly = await updateBoardSettings(board.id, ownerPayload, {
      votingEnabled: true,
      readOnly: true,
    });
    revision = await assertMutationRevision(board.id, revision, readOnly);
    await assert.rejects(
      () => updateTargetCard(
        board.id,
        createdCard.card.id,
        ownerPayload,
        createVisitorIdentity(board.id, ownerPayload),
        { text: "Нельзя изменить" },
      ),
      hasCode("BOARD_READ_ONLY"),
    );
    await assert.rejects(
      () => voteForCard(
        board.id,
        createdCard.card.id,
        ownerPayload,
        createVisitorIdentity(board.id, ownerPayload),
      ),
      hasCode("BOARD_READ_ONLY"),
    );
    assert.equal(await getBoardRevision(board.id), revision);

    const writable = await updateBoardSettings(board.id, ownerPayload, { readOnly: false });
    revision = await assertMutationRevision(board.id, revision, writable);

    const thirdColumn = await createBoardColumn(board.id, ownerPayload, {
      title: "  Риски  ",
      voteLimit: 4,
      placement: {
        beforeColumnId: columns[1].id,
        afterColumnId: null,
      },
      expectedRevision: revision.toString(),
    });
    revision = await assertMutationRevision(board.id, revision, thirdColumn);
    assert.equal(thirdColumn.column.title, "Риски");

    await assert.rejects(
      () => createBoardColumn(board.id, ownerPayload, {
        title: "Устаревшая вставка",
        voteLimit: 3,
        placement: {
          beforeColumnId: thirdColumn.column.id,
          afterColumnId: null,
        },
        expectedRevision: (revision - 1n).toString(),
      }),
      (error) => {
        assert.equal(error?.code, "STALE_BOARD_REVISION");
        assert.deepEqual(error?.details, { currentRevision: revision.toString() });
        return true;
      },
    );
    assert.equal(await getBoardRevision(board.id), revision);

    const movedColumn = await moveBoardColumn(
      board.id,
      thirdColumn.column.id,
      ownerPayload,
      {
        placement: { beforeColumnId: null, afterColumnId: columns[0].id },
        expectedRevision: revision.toString(),
      },
    );
    revision = await assertMutationRevision(board.id, revision, movedColumn);

    const noOpColumn = await updateBoardColumn(
      board.id,
      thirdColumn.column.id,
      ownerPayload,
      { title: " Риски " },
    );
    revision = await assertMutationRevision(board.id, revision, noOpColumn, 0n);
    const renamedColumn = await updateBoardColumn(
      board.id,
      thirdColumn.column.id,
      ownerPayload,
      { title: "Риски и зависимости" },
    );
    revision = await assertMutationRevision(board.id, revision, renamedColumn);

    await assert.rejects(
      () => updateBoardColumn(
        board.id,
        thirdColumn.column.id,
        ownerPayload,
        { voteLimit: 2 },
      ),
      {
        name: "RangeError",
        message: "expectedRevision is required when voteLimit is present",
      },
    );
    assert.equal(await getBoardRevision(board.id), revision);
    const loweredLimit = await updateBoardColumn(
      board.id,
      thirdColumn.column.id,
      ownerPayload,
      { voteLimit: 2, expectedRevision: revision.toString() },
    );
    revision = await assertMutationRevision(board.id, revision, loweredLimit);

    await prisma.boardColumn.createMany({
      data: Array.from({ length: 7 }, (_, index) => ({
        boardId: board.id,
        title: `Дополнительная ${index + 1}`,
        position: 10_000 + index * 1024,
        voteLimit: 3,
      })),
    });
    assert.equal(await prisma.boardColumn.count({ where: { boardId: board.id } }), 10);
    await assert.rejects(
      () => createBoardColumn(board.id, ownerPayload, {
        title: "Одиннадцатая",
        voteLimit: 3,
        placement: { beforeColumnId: null, afterColumnId: thirdColumn.column.id },
        expectedRevision: revision.toString(),
      }),
      hasCode("BOARD_COLUMN_LIMIT_REACHED"),
    );
    assert.equal(await prisma.boardColumn.count({ where: { boardId: board.id } }), 10);
    assert.equal(await getBoardRevision(board.id), revision);
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("card ownership follows the current membership across revoke and rejoin", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const ownerPayload = createVisitorPayload();
  const participantPayload = createVisitorPayload();
  fixture.visitorPayloads.push(ownerPayload, participantPayload);

  try {
    const board = await createTargetBoard(ownerPayload, "Владение карточками");
    fixture.boardIds.push(board.id);
    const [column] = await prisma.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    const invitation = await createParticipantInvitation(board.id, ownerPayload);
    const firstMembership = await redeemBoardInvitation(
      invitation.token,
      participantPayload,
      "Участник",
    );

    let revision = await getBoardRevision(board.id);
    const participantCard = await createTargetCard(board.id, participantPayload, {
      columnId: column.id,
      text: "  Карточка участника  ",
      author: "  Автор  ",
    });
    revision = await assertMutationRevision(board.id, revision, participantCard);
    assert.equal(participantCard.card.text, "Карточка участника");
    assert.equal(participantCard.card.author, "Автор");
    assert.equal(
      (
        await prisma.card.findUniqueOrThrow({
          where: { id: participantCard.card.id },
          select: { createdByMembershipId: true },
        })
      ).createdByMembershipId,
      firstMembership.membershipId,
    );

    const participantNoOp = await updateTargetCard(
      board.id,
      participantCard.card.id,
      participantPayload,
      createVisitorIdentity(board.id, participantPayload),
      { text: " Карточка участника ", author: " Автор " },
    );
    revision = await assertMutationRevision(board.id, revision, participantNoOp, 0n);
    const ownerEdit = await updateTargetCard(
      board.id,
      participantCard.card.id,
      ownerPayload,
      createVisitorIdentity(board.id, ownerPayload),
      { text: "Владелец изменил карточку" },
    );
    revision = await assertMutationRevision(board.id, revision, ownerEdit);

    const ownerCard = await createTargetCard(board.id, ownerPayload, {
      columnId: column.id,
      text: "Карточка владельца",
    });
    revision = await assertMutationRevision(board.id, revision, ownerCard);
    await assert.rejects(
      () => updateTargetCard(
        board.id,
        ownerCard.card.id,
        participantPayload,
        createVisitorIdentity(board.id, participantPayload),
        { text: "Чужое изменение" },
      ),
      hasCode("CARD_OWNER_REQUIRED"),
    );
    assert.equal(await getBoardRevision(board.id), revision);

    await revokeBoardParticipant(board.id, firstMembership.membershipId, ownerPayload);
    const rejoinInvitation = await createParticipantInvitation(board.id, ownerPayload);
    const secondMembership = await redeemBoardInvitation(
      rejoinInvitation.token,
      participantPayload,
      "Участник вернулся",
    );
    assert.notEqual(secondMembership.membershipId, firstMembership.membershipId);
    assert.equal(await getBoardRevision(board.id), revision);

    await assert.rejects(
      () => updateTargetCard(
        board.id,
        participantCard.card.id,
        participantPayload,
        createVisitorIdentity(board.id, participantPayload),
        { text: "Новая membership не владеет старой карточкой" },
      ),
      hasCode("CARD_OWNER_REQUIRED"),
    );
    assert.equal(await getBoardRevision(board.id), revision);

    const rejoinedCard = await createTargetCard(board.id, participantPayload, {
      columnId: column.id,
      text: "Карточка после возврата",
    });
    revision = await assertMutationRevision(board.id, revision, rejoinedCard);
    const ownershipRows = await prisma.card.findMany({
      where: { id: { in: [participantCard.card.id, rejoinedCard.card.id] } },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdByMembershipId: true },
    });
    const ownershipByCard = new Map(
      ownershipRows.map((card) => [card.id, card.createdByMembershipId]),
    );
    assert.equal(ownershipByCard.get(participantCard.card.id), firstMembership.membershipId);
    assert.equal(ownershipByCard.get(rejoinedCard.card.id), secondMembership.membershipId);
    assert.ok(
      (
        await prisma.boardMembership.findUniqueOrThrow({
          where: { id: firstMembership.membershipId },
          select: { revokedAt: true },
        })
      ).revokedAt,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("votes are idempotent, quota-safe under concurrency, compactable, movable, and resettable", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const ownerPayload = createVisitorPayload();
  fixture.visitorPayloads.push(ownerPayload);

  try {
    const board = await createTargetBoard(ownerPayload, "Голосование");
    fixture.boardIds.push(board.id);
    const [sourceColumn, targetColumn] = await prisma.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    const sourceCards = [];
    let revision = await getBoardRevision(board.id);
    for (let index = 0; index < 4; index += 1) {
      const result = await createTargetCard(board.id, ownerPayload, {
        columnId: sourceColumn.id,
        text: `Карточка ${index + 1}`,
      });
      revision = await assertMutationRevision(board.id, revision, result);
      sourceCards.push(result.card);
    }
    const targetCardResult = await createTargetCard(board.id, ownerPayload, {
      columnId: targetColumn.id,
      text: "Целевая карточка",
    });
    revision = await assertMutationRevision(board.id, revision, targetCardResult);
    const targetCard = targetCardResult.card;

    const idempotentIdentity = createVisitorIdentity(board.id, ownerPayload);
    const firstVote = await voteForCard(
      board.id,
      sourceCards[0].id,
      ownerPayload,
      idempotentIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, firstVote);
    const repeatedVote = await voteForCard(
      board.id,
      sourceCards[0].id,
      ownerPayload,
      idempotentIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, repeatedVote, 0n);
    assert.equal(repeatedVote.viewerHasVoted, true);
    assert.equal(
      await prisma.vote.count({
        where: { cardId: sourceCards[0].id, visitorToken: idempotentIdentity },
      }),
      1,
    );

    const firstUnvote = await removeVoteFromCard(
      board.id,
      sourceCards[0].id,
      ownerPayload,
      idempotentIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, firstUnvote);
    const repeatedUnvote = await removeVoteFromCard(
      board.id,
      sourceCards[0].id,
      ownerPayload,
      idempotentIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, repeatedUnvote, 0n);
    assert.equal(repeatedUnvote.viewerHasVoted, false);

    const legacyLike = await likeCardLegacyAdapter(
      board.id,
      sourceCards[0].id,
      ownerPayload,
      idempotentIdentity,
    );
    revision += 1n;
    assert.equal(await getBoardRevision(board.id), revision);
    assert.deepEqual(legacyLike, {
      cardId: sourceCards[0].id,
      likesCount: 1,
      remainingVotesInColumn: 2,
    });
    await assert.rejects(
      () => likeCardLegacyAdapter(
        board.id,
        sourceCards[0].id,
        ownerPayload,
        idempotentIdentity,
      ),
      hasCode("LIKE_ALREADY_EXISTS"),
    );
    assert.equal(await getBoardRevision(board.id), revision);
    const removedLegacyLike = await removeVoteFromCard(
      board.id,
      sourceCards[0].id,
      ownerPayload,
      idempotentIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, removedLegacyLike);

    const quotaIdentity = createVisitorIdentity(board.id, ownerPayload);
    const beforeConcurrentQuota = revision;
    const concurrentVotes = await Promise.allSettled(
      sourceCards.map((card) => voteForCard(
        board.id,
        card.id,
        ownerPayload,
        quotaIdentity,
      )),
    );
    const fulfilledQuotaVotes = concurrentVotes.filter((result) => result.status === "fulfilled");
    const rejectedQuotaVotes = concurrentVotes.filter((result) => result.status === "rejected");
    assert.equal(fulfilledQuotaVotes.length, 3);
    assert.equal(rejectedQuotaVotes.length, 1);
    assert.equal(rejectedQuotaVotes[0].reason?.code, "COLUMN_VOTE_LIMIT_REACHED");
    revision = beforeConcurrentQuota + 3n;
    assert.equal(await getBoardRevision(board.id), revision);
    assert.deepEqual(
      fulfilledQuotaVotes
        .map((result) => BigInt(result.value.revision))
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0)),
      [beforeConcurrentQuota + 1n, beforeConcurrentQuota + 2n, beforeConcurrentQuota + 3n],
    );
    assert.deepEqual(
      (
        await prisma.vote.findMany({
          where: {
            boardId: board.id,
            columnId: sourceColumn.id,
            visitorToken: quotaIdentity,
          },
          orderBy: { quotaSlot: "asc" },
          select: { quotaSlot: true },
        })
      ).map((vote) => vote.quotaSlot),
      [1, 2, 3],
    );

    const middleVote = await prisma.vote.findFirstOrThrow({
      where: {
        boardId: board.id,
        columnId: sourceColumn.id,
        visitorToken: quotaIdentity,
        quotaSlot: 2,
      },
      select: { cardId: true },
    });
    const removedMiddle = await removeVoteFromCard(
      board.id,
      middleVote.cardId,
      ownerPayload,
      quotaIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, removedMiddle);
    assert.deepEqual(
      (
        await prisma.vote.findMany({
          where: {
            boardId: board.id,
            columnId: sourceColumn.id,
            visitorToken: quotaIdentity,
          },
          orderBy: { quotaSlot: "asc" },
          select: { quotaSlot: true },
        })
      ).map((vote) => vote.quotaSlot),
      [1, 3],
    );
    const compactedLimit = await updateBoardColumn(
      board.id,
      sourceColumn.id,
      ownerPayload,
      { voteLimit: 2, expectedRevision: revision.toString() },
    );
    revision = await assertMutationRevision(board.id, revision, compactedLimit);
    assert.deepEqual(
      (
        await prisma.vote.findMany({
          where: {
            boardId: board.id,
            columnId: sourceColumn.id,
            visitorToken: quotaIdentity,
          },
          orderBy: { quotaSlot: "asc" },
          select: { quotaSlot: true },
        })
      ).map((vote) => vote.quotaSlot),
      [1, 2],
    );

    const targetLimit = await updateBoardColumn(
      board.id,
      targetColumn.id,
      ownerPayload,
      { voteLimit: 1, expectedRevision: revision.toString() },
    );
    revision = await assertMutationRevision(board.id, revision, targetLimit);

    const sameCardIdentity = createVisitorIdentity(board.id, ownerPayload);
    const beforeConcurrentIdempotency = revision;
    const sameCardResults = await Promise.all([
      voteForCard(board.id, targetCard.id, ownerPayload, sameCardIdentity),
      voteForCard(board.id, targetCard.id, ownerPayload, sameCardIdentity),
    ]);
    revision = beforeConcurrentIdempotency + 1n;
    assert.equal(await getBoardRevision(board.id), revision);
    assert.deepEqual(
      sameCardResults.map((result) => result.revision),
      [revision.toString(), revision.toString()],
    );
    assert.equal(
      await prisma.vote.count({
        where: { cardId: targetCard.id, visitorToken: sameCardIdentity },
      }),
      1,
    );

    const movingIdentity = createVisitorIdentity(board.id, ownerPayload);
    const movingCardVote = await prisma.vote.findFirstOrThrow({
      where: {
        boardId: board.id,
        columnId: sourceColumn.id,
        visitorToken: movingIdentity,
      },
      orderBy: [{ quotaSlot: "asc" }, { id: "asc" }],
      select: { cardId: true },
    });
    const targetVote = await voteForCard(
      board.id,
      targetCard.id,
      ownerPayload,
      movingIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, targetVote, 0n);
    const sourceVote = await voteForCard(
      board.id,
      movingCardVote.cardId,
      ownerPayload,
      movingIdentity,
    );
    revision = await assertMutationRevision(board.id, revision, sourceVote, 0n);
    await assert.rejects(
      () => moveTargetCard(
        board.id,
        movingCardVote.cardId,
        ownerPayload,
        movingIdentity,
        {
          targetColumnId: targetColumn.id,
          placement: { before: null, after: { kind: "CARD", id: targetCard.id } },
          expectedRevision: revision.toString(),
        },
      ),
      hasCode("VOTE_MOVE_CONFLICT"),
    );
    assert.equal(await getBoardRevision(board.id), revision);
    assert.equal(
      (
        await prisma.card.findUniqueOrThrow({
          where: { id: movingCardVote.cardId },
          select: { columnId: true },
        })
      ).columnId,
      sourceColumn.id,
    );

    const reset = await resetBoardVotes(board.id, ownerPayload, revision.toString());
    assert.ok(reset.deletedVotes > 0);
    revision = await assertMutationRevision(board.id, revision, reset);
    assert.equal(await prisma.vote.count({ where: { boardId: board.id } }), 0);
    const noOpReset = await resetBoardVotes(board.id, ownerPayload, revision.toString());
    assert.equal(noOpReset.deletedVotes, 0);
    revision = await assertMutationRevision(board.id, revision, noOpReset, 0n);
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("groups and action items support the Stage 1 lifecycle and limits", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const ownerPayload = createVisitorPayload();
  fixture.visitorPayloads.push(ownerPayload);

  try {
    const board = await createTargetBoard(ownerPayload, "Группы и action items");
    fixture.boardIds.push(board.id);
    const [sourceColumn, targetColumn] = await prisma.boardColumn.findMany({
      where: { boardId: board.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    });
    const cards = [];
    let revision = await getBoardRevision(board.id);
    for (let index = 0; index < 3; index += 1) {
      const result = await createTargetCard(board.id, ownerPayload, {
        columnId: sourceColumn.id,
        text: `  Исходная карточка ${index + 1}  `,
      });
      revision = await assertMutationRevision(board.id, revision, result);
      cards.push(result.card);
    }

    const ownerIdentity = createVisitorIdentity(board.id, ownerPayload);
    const createdGroup = await createCardGroup(
      board.id,
      ownerPayload,
      ownerIdentity,
      {
        columnId: sourceColumn.id,
        cardIds: [cards[0].id, cards[1].id],
        primaryCardId: cards[0].id,
        title: "  Тема  ",
        expectedRevision: revision.toString(),
      },
    );
    revision = await assertMutationRevision(board.id, revision, createdGroup);
    assert.equal(createdGroup.group.title, "Тема");
    assert.equal(createdGroup.group.primaryCardId, cards[0].id);
    assert.deepEqual(
      new Set(createdGroup.group.cards.map((card) => card.id)),
      new Set([cards[0].id, cards[1].id]),
    );
    const groupedCards = await prisma.card.findMany({
      where: { id: { in: [cards[0].id, cards[1].id] } },
      orderBy: [{ groupPosition: "asc" }, { id: "asc" }],
      select: { groupId: true, groupPosition: true },
    });
    assert.ok(groupedCards.every((card) => card.groupId === createdGroup.group.id));
    assert.deepEqual(groupedCards.map((card) => card.groupPosition), [1024, 2048]);

    const noOpGroup = await updateCardGroup(
      board.id,
      createdGroup.group.id,
      ownerPayload,
      ownerIdentity,
      { title: " Тема " },
    );
    revision = await assertMutationRevision(board.id, revision, noOpGroup, 0n);
    const renamedGroup = await updateCardGroup(
      board.id,
      createdGroup.group.id,
      ownerPayload,
      ownerIdentity,
      { title: "Доставка" },
    );
    revision = await assertMutationRevision(board.id, revision, renamedGroup);
    const changedPrimary = await updateCardGroup(
      board.id,
      createdGroup.group.id,
      ownerPayload,
      ownerIdentity,
      { primaryCardId: cards[1].id, expectedRevision: revision.toString() },
    );
    revision = await assertMutationRevision(board.id, revision, changedPrimary);
    assert.equal(changedPrimary.group.primaryCardId, cards[1].id);

    const movedGroup = await moveCardGroup(
      board.id,
      createdGroup.group.id,
      ownerPayload,
      ownerIdentity,
      {
        targetColumnId: targetColumn.id,
        placement: { before: null, after: null },
        expectedRevision: revision.toString(),
      },
    );
    revision = await assertMutationRevision(board.id, revision, movedGroup);
    assert.equal(movedGroup.group.columnId, targetColumn.id);
    assert.equal(
      await prisma.card.count({
        where: {
          id: { in: [cards[0].id, cards[1].id] },
          columnId: targetColumn.id,
          groupId: createdGroup.group.id,
        },
      }),
      2,
    );

    const ungrouped = await ungroupCardGroup(
      board.id,
      createdGroup.group.id,
      ownerPayload,
      ownerIdentity,
      revision.toString(),
    );
    revision = await assertMutationRevision(board.id, revision, ungrouped);
    assert.deepEqual(
      new Set(ungrouped.items.map((item) => item.id)),
      new Set([cards[0].id, cards[1].id]),
    );
    assert.equal(
      await prisma.cardGroup.count({ where: { id: createdGroup.group.id } }),
      0,
    );
    assert.equal(
      await prisma.card.count({
        where: {
          id: { in: [cards[0].id, cards[1].id] },
          columnId: targetColumn.id,
          groupId: null,
          groupPosition: null,
        },
      }),
      2,
    );

    const manualAction = await createActionItem(board.id, ownerPayload, {
      source: "manual",
      text: "  Подготовить релиз  ",
      assignee: "  Команда  ",
    });
    revision = await assertMutationRevision(board.id, revision, manualAction);
    assert.equal(manualAction.actionItem.text, "Подготовить релиз");
    assert.equal(manualAction.actionItem.assignee, "Команда");
    assert.equal(manualAction.actionItem.sourceCardId, null);

    const cardAction = await createActionItem(board.id, ownerPayload, {
      source: "card",
      sourceCardId: cards[0].id,
      assignee: null,
    });
    revision = await assertMutationRevision(board.id, revision, cardAction);
    assert.equal(cardAction.actionItem.text, cards[0].text);
    assert.equal(cardAction.actionItem.sourceCardId, cards[0].id);

    const noOpAction = await updateActionItem(
      board.id,
      manualAction.actionItem.id,
      ownerPayload,
      { text: " Подготовить релиз ", assignee: " Команда ", completed: false },
    );
    revision = await assertMutationRevision(board.id, revision, noOpAction, 0n);
    const completedAction = await updateActionItem(
      board.id,
      manualAction.actionItem.id,
      ownerPayload,
      { completed: true },
    );
    revision = await assertMutationRevision(board.id, revision, completedAction);
    assert.equal(completedAction.actionItem.completed, true);

    const movedAction = await moveActionItem(
      board.id,
      manualAction.actionItem.id,
      ownerPayload,
      {
        placement: {
          beforeActionItemId: null,
          afterActionItemId: cardAction.actionItem.id,
        },
        expectedRevision: revision.toString(),
      },
    );
    revision = await assertMutationRevision(board.id, revision, movedAction);
    const orderedActionIds = (
      await prisma.actionItem.findMany({
        where: { boardId: board.id },
        orderBy: [{ position: "asc" }, { id: "asc" }],
        select: { id: true },
      })
    ).map((item) => item.id);
    assert.deepEqual(orderedActionIds, [manualAction.actionItem.id, cardAction.actionItem.id]);

    await prisma.actionItem.createMany({
      data: Array.from(
        { length: MAX_BOARD_ACTION_ITEMS - 2 },
        (_, index) => ({
          boardId: board.id,
          text: `Лимит ${index + 1}`,
          position: 50_000 + index,
        }),
      ),
    });
    assert.equal(
      await prisma.actionItem.count({ where: { boardId: board.id } }),
      MAX_BOARD_ACTION_ITEMS,
    );
    await assert.rejects(
      () => createActionItem(board.id, ownerPayload, {
        source: "manual",
        text: "Превышение лимита",
      }),
      hasCode("BOARD_ACTION_ITEM_LIMIT_REACHED"),
    );
    assert.equal(await getBoardRevision(board.id), revision);
    assert.equal(
      await prisma.actionItem.count({ where: { boardId: board.id } }),
      MAX_BOARD_ACTION_ITEMS,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  createParticipantInvitation,
  redeemBoardInvitation,
} from "../access/acl-service.ts";
import { deriveSessionCredentialHash } from "../access/session-service.ts";
import {
  deriveBoardVisitorId,
  getVisitorTokenSecret,
} from "../cookies/visitor-token-core.ts";
import { prisma } from "../prisma/client.ts";
import {
  createActionItem,
  moveActionItem,
} from "./action-items-service.ts";
import {
  createTargetBoard,
  updateBoardSettings,
} from "./board-settings-service.ts";
import { getTargetBoardExport } from "./board-export-service.ts";
import {
  getTargetBoardSnapshot,
  getTargetCardPage,
} from "./board-query-service.ts";
import {
  createTargetCard,
  deleteTargetCard,
  moveTargetCard,
  resetBoardVotes,
  voteForCard,
} from "./cards-votes-service.ts";
import {
  createBoardColumn,
  deleteBoardColumn,
  moveBoardColumn,
  updateBoardColumn,
} from "./columns-service.ts";
import {
  createCardGroup,
  moveCardGroup,
  updateCardGroup,
} from "./groups-service.ts";

const databaseTest = process.env.RUN_DATABASE_TESTS === "1" ? test : test.skip;
const createVisitorPayload = () => randomBytes(32).toString("base64url");
const identityFor = (visitorPayload, boardId) => deriveBoardVisitorId(
  visitorPayload,
  boardId,
  getVisitorTokenSecret(),
);

const hasCode = (code) => (error) => {
  assert.equal(error?.code, code);
  return true;
};

const getBoardRevision = async (boardId) => (
  await prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { revision: true } })
).revision;

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

const setupBoard = async (fixture, title, ownerPayload = createVisitorPayload()) => {
  if (!fixture.visitorPayloads.includes(ownerPayload)) {
    fixture.visitorPayloads.push(ownerPayload);
  }
  const board = await createTargetBoard(ownerPayload, title);
  fixture.boardIds.push(board.id);
  const columns = await prisma.boardColumn.findMany({
    where: { boardId: board.id },
    orderBy: [{ position: "asc" }, { id: "asc" }],
  });
  return {
    id: board.id,
    ownerPayload,
    ownerIdentity: identityFor(ownerPayload, board.id),
    columns,
    revision: BigInt(board.revision),
  };
};

const advanceRevision = async (context, result, delta = 1n) => {
  context.revision += delta;
  assert.equal(result.revision, context.revision.toString());
  assert.equal(await getBoardRevision(context.id), context.revision);
  return result;
};

const createCard = async (context, columnId, text) => {
  const result = await createTargetCard(context.id, context.ownerPayload, { columnId, text });
  await advanceRevision(context, result);
  return result.card;
};

const createManualAction = async (context, text) => {
  const result = await createActionItem(context.id, context.ownerPayload, {
    source: "manual",
    text,
  });
  await advanceRevision(context, result);
  return result.actionItem;
};

const getTopLevelPage = (context, columnId, limit = 100) => getTargetCardPage(
  context.id,
  context.ownerPayload,
  context.ownerIdentity,
  columnId,
  undefined,
  limit,
);

const itemRef = (item) => ({ kind: item.kind, id: item.id });

const assertNoPrivateKeys = (value) => {
  const forbidden = new Set([
    "createdByMembershipId",
    "membershipId",
    "quotaSlot",
    "sessionId",
    "visitorIdentity",
    "visitorToken",
  ]);
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (!entry || typeof entry !== "object") {
      return;
    }
    for (const [key, nested] of Object.entries(entry)) {
      assert.equal(forbidden.has(key), false, `private key leaked: ${key}`);
      visit(nested);
    }
  };
  visit(value);
};

databaseTest("moving in vote order materializes the visible column order", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  try {
    const context = await setupBoard(fixture, "Порядок по голосам");
    const sourceColumn = context.columns[0];
    const votedCard = await createCard(context, sourceColumn.id, "С голосом");
    const middleCard = await createCard(context, sourceColumn.id, "Без голоса 1");
    const headCard = await createCard(context, sourceColumn.id, "Без голоса 2");
    const vote = await voteForCard(
      context.id,
      votedCard.id,
      context.ownerPayload,
      context.ownerIdentity,
    );
    await advanceRevision(context, vote);

    const moved = await moveTargetCard(
      context.id,
      votedCard.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        targetColumnId: sourceColumn.id,
        placement: {
          before: itemRef(headCard),
          after: itemRef(middleCard),
        },
        voteSortedColumnIds: [sourceColumn.id],
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, moved);

    const page = await getTopLevelPage(context, sourceColumn.id);
    assert.deepEqual(
      page.items.map((item) => item.id),
      [headCard.id, votedCard.id, middleCard.id],
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("column deletion respects read-only, cards-disabled, empty, and last-column rules", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  try {
    const context = await setupBoard(fixture, "Удаление пустой колонки");
    const readOnly = await updateBoardSettings(context.id, context.ownerPayload, {
      readOnly: true,
    });
    await advanceRevision(context, readOnly);
    await assert.rejects(
      () => deleteBoardColumn(
        context.id,
        context.columns[0].id,
        context.ownerPayload,
        { expectedRevision: context.revision.toString() },
      ),
      hasCode("BOARD_READ_ONLY"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);

    const cardsDisabled = await updateBoardSettings(context.id, context.ownerPayload, {
      readOnly: false,
      cardsEnabled: false,
    });
    await advanceRevision(context, cardsDisabled);
    const deletedEmpty = await deleteBoardColumn(
      context.id,
      context.columns[0].id,
      context.ownerPayload,
      { expectedRevision: context.revision.toString() },
    );
    await advanceRevision(context, deletedEmpty);
    assert.equal(
      await prisma.boardColumn.count({ where: { boardId: context.id } }),
      1,
    );

    await assert.rejects(
      () => deleteBoardColumn(
        context.id,
        context.columns[1].id,
        context.ownerPayload,
        { expectedRevision: context.revision.toString() },
      ),
      hasCode("LAST_COLUMN_DELETE_FORBIDDEN"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);
    assert.equal(
      await prisma.boardColumn.count({ where: { boardId: context.id } }),
      1,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("moveCards deletion preserves order and groups, compacts votes, and rolls back conflicts", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  try {
    const context = await setupBoard(fixture, "Перенос колонки");
    const [sourceColumn, targetColumn] = context.columns;
    const targetCard = await createCard(context, targetColumn.id, "Карточка назначения");
    const sourceCards = [
      await createCard(context, sourceColumn.id, "Источник 1"),
      await createCard(context, sourceColumn.id, "Источник 2"),
      await createCard(context, sourceColumn.id, "Источник 3"),
    ];
    const groupResult = await createCardGroup(
      context.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        columnId: sourceColumn.id,
        cardIds: [sourceCards[0].id, sourceCards[1].id],
        primaryCardId: sourceCards[0].id,
        title: "Группа источника",
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, groupResult);
    const actionResult = await createActionItem(context.id, context.ownerPayload, {
      source: "card",
      sourceCardId: sourceCards[2].id,
    });
    await advanceRevision(context, actionResult);

    for (const cardId of [targetCard.id, sourceCards[0].id, sourceCards[2].id]) {
      const vote = await voteForCard(
        context.id,
        cardId,
        context.ownerPayload,
        context.ownerIdentity,
      );
      await advanceRevision(context, vote);
    }

    const disabled = await updateBoardSettings(context.id, context.ownerPayload, {
      cardsEnabled: false,
    });
    await advanceRevision(context, disabled);
    await assert.rejects(
      () => deleteBoardColumn(context.id, sourceColumn.id, context.ownerPayload, {
        strategy: "moveCards",
        targetColumnId: targetColumn.id,
        expectedRevision: context.revision.toString(),
      }),
      hasCode("CARDS_DISABLED"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);
    assert.equal(await prisma.card.count({ where: { columnId: sourceColumn.id } }), 3);

    const enabled = await updateBoardSettings(context.id, context.ownerPayload, {
      cardsEnabled: true,
    });
    await advanceRevision(context, enabled);
    const constrainedTarget = await updateBoardColumn(
      context.id,
      targetColumn.id,
      context.ownerPayload,
      { voteLimit: 2, expectedRevision: context.revision.toString() },
    );
    await advanceRevision(context, constrainedTarget);
    await assert.rejects(
      () => deleteBoardColumn(context.id, sourceColumn.id, context.ownerPayload, {
        strategy: "moveCards",
        targetColumnId: targetColumn.id,
        expectedRevision: context.revision.toString(),
      }),
      (error) => {
        assert.equal(error?.code, "VOTE_MOVE_CONFLICT");
        assert.deepEqual(error?.details, { targetColumnId: targetColumn.id });
        return true;
      },
    );
    assert.equal(await getBoardRevision(context.id), context.revision);
    assert.equal(await prisma.card.count({ where: { columnId: sourceColumn.id } }), 3);
    assert.equal(await prisma.boardColumn.count({ where: { id: sourceColumn.id } }), 1);

    const expandedTarget = await updateBoardColumn(
      context.id,
      targetColumn.id,
      context.ownerPayload,
      { voteLimit: 3, expectedRevision: context.revision.toString() },
    );
    await advanceRevision(context, expandedTarget);
    const [sourceBefore, targetBefore] = await Promise.all([
      getTopLevelPage(context, sourceColumn.id),
      getTopLevelPage(context, targetColumn.id),
    ]);
    const moved = await deleteBoardColumn(
      context.id,
      sourceColumn.id,
      context.ownerPayload,
      {
        strategy: "moveCards",
        targetColumnId: targetColumn.id,
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, moved);

    assert.equal(await prisma.boardColumn.count({ where: { id: sourceColumn.id } }), 0);
    const targetAfter = await getTopLevelPage(context, targetColumn.id);
    assert.deepEqual(
      targetAfter.items.map(itemRef),
      [...targetBefore.items, ...sourceBefore.items].map(itemRef),
    );
    assert.equal(
      await prisma.card.count({
        where: { id: { in: sourceCards.map((card) => card.id) }, columnId: targetColumn.id },
      }),
      3,
    );
    assert.equal(
      (
        await prisma.cardGroup.findUniqueOrThrow({
          where: { id: groupResult.group.id },
          select: { columnId: true, primaryCardId: true },
        })
      ).columnId,
      targetColumn.id,
    );
    assert.deepEqual(
      (
        await prisma.vote.findMany({
          where: {
            boardId: context.id,
            columnId: targetColumn.id,
            visitorToken: context.ownerIdentity,
          },
          orderBy: { quotaSlot: "asc" },
          select: { quotaSlot: true },
        })
      ).map((vote) => vote.quotaSlot),
      [1, 2, 3],
    );
    assert.equal(
      (
        await prisma.actionItem.findUniqueOrThrow({
          where: { id: actionResult.actionItem.id },
          select: { sourceCardId: true },
        })
      ).sourceCardId,
      sourceCards[2].id,
    );
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("deleteCards deletion removes groups and votes but preserves unlinked action items", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  try {
    const context = await setupBoard(fixture, "Удаление содержимого колонки");
    const [sourceColumn, remainingColumn] = context.columns;
    const sourceCards = [
      await createCard(context, sourceColumn.id, "Удаляемая 1"),
      await createCard(context, sourceColumn.id, "Удаляемая 2"),
      await createCard(context, sourceColumn.id, "Удаляемая 3"),
    ];
    const groupResult = await createCardGroup(
      context.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        columnId: sourceColumn.id,
        cardIds: [sourceCards[0].id, sourceCards[1].id],
        primaryCardId: sourceCards[0].id,
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, groupResult);
    const actionResult = await createActionItem(context.id, context.ownerPayload, {
      source: "card",
      sourceCardId: sourceCards[0].id,
      assignee: "Владелец",
    });
    await advanceRevision(context, actionResult);
    const copiedActionText = actionResult.actionItem.text;
    for (const cardId of [sourceCards[0].id, sourceCards[2].id]) {
      const vote = await voteForCard(
        context.id,
        cardId,
        context.ownerPayload,
        context.ownerIdentity,
      );
      await advanceRevision(context, vote);
    }

    await assert.rejects(
      () => deleteBoardColumn(
        context.id,
        sourceColumn.id,
        context.ownerPayload,
        { expectedRevision: context.revision.toString() },
      ),
      hasCode("COLUMN_NOT_EMPTY"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);
    assert.equal(await prisma.card.count({ where: { columnId: sourceColumn.id } }), 3);

    const deleted = await deleteBoardColumn(
      context.id,
      sourceColumn.id,
      context.ownerPayload,
      {
        strategy: "deleteCards",
        confirmDeleteCards: true,
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, deleted);
    assert.equal(await prisma.boardColumn.count({ where: { id: sourceColumn.id } }), 0);
    assert.equal(await prisma.boardColumn.count({ where: { id: remainingColumn.id } }), 1);
    assert.equal(
      await prisma.card.count({ where: { id: { in: sourceCards.map((card) => card.id) } } }),
      0,
    );
    assert.equal(await prisma.cardGroup.count({ where: { id: groupResult.group.id } }), 0);
    assert.equal(await prisma.vote.count({ where: { boardId: context.id } }), 0);
    const preservedAction = await prisma.actionItem.findUniqueOrThrow({
      where: { id: actionResult.actionItem.id },
      select: { text: true, assignee: true, sourceCardId: true },
    });
    assert.deepEqual(preservedAction, {
      text: copiedActionText,
      assignee: "Владелец",
      sourceCardId: null,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("deleting grouped cards replaces the primary, dissolves a pair, and unlinks sources", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  try {
    const context = await setupBoard(fixture, "Удаление originals");
    const [column] = context.columns;
    const cards = [
      await createCard(context, column.id, "Original 1"),
      await createCard(context, column.id, "Original 2"),
      await createCard(context, column.id, "Original 3"),
    ];
    const groupResult = await createCardGroup(
      context.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        columnId: column.id,
        cardIds: cards.map((card) => card.id),
        primaryCardId: cards[0].id,
        title: "Три originals",
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, groupResult);
    const actionResult = await createActionItem(context.id, context.ownerPayload, {
      source: "card",
      sourceCardId: cards[0].id,
    });
    await advanceRevision(context, actionResult);
    const vote = await voteForCard(
      context.id,
      cards[0].id,
      context.ownerPayload,
      context.ownerIdentity,
    );
    await advanceRevision(context, vote);

    const orderedBefore = await prisma.card.findMany({
      where: { groupId: groupResult.group.id },
      orderBy: [{ groupPosition: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const expectedPrimary = orderedBefore.find((card) => card.id !== cards[0].id).id;
    const deletedPrimary = await deleteTargetCard(
      context.id,
      cards[0].id,
      context.ownerPayload,
      context.revision.toString(),
    );
    await advanceRevision(context, deletedPrimary);
    const groupAfterPrimaryDelete = await prisma.cardGroup.findUniqueOrThrow({
      where: { id: groupResult.group.id },
      select: { position: true, primaryCardId: true },
    });
    assert.equal(groupAfterPrimaryDelete.primaryCardId, expectedPrimary);
    assert.equal(
      await prisma.card.count({ where: { groupId: groupResult.group.id } }),
      2,
    );
    assert.equal(
      (
        await prisma.actionItem.findUniqueOrThrow({
          where: { id: actionResult.actionItem.id },
          select: { sourceCardId: true },
        })
      ).sourceCardId,
      null,
    );
    assert.equal(await prisma.vote.count({ where: { cardId: cards[0].id } }), 0);

    const remainingPair = await prisma.card.findMany({
      where: { groupId: groupResult.group.id },
      orderBy: [{ groupPosition: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const cardToDelete = remainingPair[0].id;
    const survivorId = remainingPair[1].id;
    const dissolved = await deleteTargetCard(
      context.id,
      cardToDelete,
      context.ownerPayload,
      context.revision.toString(),
    );
    await advanceRevision(context, dissolved);
    assert.equal(await prisma.cardGroup.count({ where: { id: groupResult.group.id } }), 0);
    const survivor = await prisma.card.findUniqueOrThrow({
      where: { id: survivorId },
      select: { groupId: true, groupPosition: true, position: true },
    });
    assert.deepEqual(survivor, {
      groupId: null,
      groupPosition: null,
      position: groupAfterPrimaryDelete.position,
    });
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("snapshot and card pages keep cursors current, board-scoped, and position-bound", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const ownerPayload = createVisitorPayload();
  const participantPayload = createVisitorPayload();
  fixture.visitorPayloads.push(participantPayload);
  try {
    const context = await setupBoard(fixture, "Cursor board", ownerPayload);
    const foreignContext = await setupBoard(fixture, "Foreign cursor board", ownerPayload);
    const [sourceColumn, targetColumn] = context.columns;
    const cards = [
      await createCard(context, sourceColumn.id, "Cursor 1"),
      await createCard(context, sourceColumn.id, "Cursor 2"),
      await createCard(context, sourceColumn.id, "Cursor 3"),
    ];
    const action = await createManualAction(context, "Snapshot action");
    const invitation = await createParticipantInvitation(context.id, context.ownerPayload);
    await redeemBoardInvitation(invitation.token, participantPayload, "Читатель");
    const participantIdentity = identityFor(participantPayload, context.id);
    const anchorCard = cards.at(-1);
    const vote = await voteForCard(
      context.id,
      anchorCard.id,
      participantPayload,
      participantIdentity,
    );
    await advanceRevision(context, vote);

    const beforeRead = context.revision;
    const snapshot = await getTargetBoardSnapshot(
      context.id,
      participantPayload,
      participantIdentity,
      1,
    );
    assert.equal(await getBoardRevision(context.id), beforeRead);
    assert.equal(snapshot.revision, beforeRead.toString());
    assert.deepEqual(snapshot.viewer, { role: "PARTICIPANT", displayName: "Читатель" });
    assert.equal(snapshot.capabilities.canManageColumns, false);
    assert.equal(snapshot.capabilities.canCreateCards, true);
    assert.equal(snapshot.actionItems[0].id, action.id);
    const sourceSnapshot = snapshot.columns.find((column) => column.id === sourceColumn.id);
    assert.ok(sourceSnapshot);
    assert.equal(sourceSnapshot.totalCount, 3);
    assert.equal(sourceSnapshot.items.length, 1);
    assert.equal(sourceSnapshot.items[0].id, anchorCard.id);
    assert.equal(sourceSnapshot.items[0].viewerHasVoted, true);
    assert.ok(sourceSnapshot.nextCursor);
    assert.equal(snapshot.remainingVotesByColumn[sourceColumn.id], 2);
    assertNoPrivateKeys(snapshot);

    const currentPage = await getTargetCardPage(
      context.id,
      participantPayload,
      participantIdentity,
      sourceColumn.id,
      sourceSnapshot.nextCursor,
      1,
    );
    assert.equal(currentPage.items.length, 1);
    assert.notEqual(currentPage.items[0].id, anchorCard.id);
    assert.equal(currentPage.totalCount, 3);
    assert.equal(await getBoardRevision(context.id), beforeRead);

    await assert.rejects(
      () => getTargetCardPage(
        context.id,
        participantPayload,
        participantIdentity,
        targetColumn.id,
        sourceSnapshot.nextCursor,
        1,
      ),
      hasCode("INVALID_CURSOR"),
    );
    await assert.rejects(
      () => getTargetCardPage(
        foreignContext.id,
        foreignContext.ownerPayload,
        foreignContext.ownerIdentity,
        foreignContext.columns[0].id,
        sourceSnapshot.nextCursor,
        1,
      ),
      hasCode("INVALID_CURSOR"),
    );

    const movedAnchor = await moveTargetCard(
      context.id,
      anchorCard.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        targetColumnId: targetColumn.id,
        placement: { before: null, after: null },
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, movedAnchor);
    const movedVote = await prisma.vote.findFirstOrThrow({
      where: { cardId: anchorCard.id, visitorToken: participantIdentity },
      select: { columnId: true, quotaSlot: true },
    });
    assert.deepEqual(movedVote, { columnId: targetColumn.id, quotaSlot: 1 });
    await assert.rejects(
      () => getTargetCardPage(
        context.id,
        participantPayload,
        participantIdentity,
        sourceColumn.id,
        sourceSnapshot.nextCursor,
        1,
      ),
      hasCode("INVALID_CURSOR"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("target export returns a coherent private-field-free v2 shape and enforces bounds", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  try {
    const context = await setupBoard(fixture, "Экспорт Stage 1");
    const [sourceColumn, emptyColumn] = context.columns;
    const cards = [
      await createCard(context, sourceColumn.id, "Export 1"),
      await createCard(context, sourceColumn.id, "Export 2"),
      await createCard(context, sourceColumn.id, "Export 3"),
      await createCard(context, sourceColumn.id, "Export 4"),
    ];
    const groupResult = await createCardGroup(
      context.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        columnId: sourceColumn.id,
        cardIds: [cards[0].id, cards[1].id],
        primaryCardId: cards[1].id,
        title: "Export group",
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, groupResult);
    for (const cardId of [cards[0].id, cards[1].id]) {
      const vote = await voteForCard(
        context.id,
        cardId,
        context.ownerPayload,
        context.ownerIdentity,
      );
      await advanceRevision(context, vote);
    }
    const actionResult = await createActionItem(context.id, context.ownerPayload, {
      source: "card",
      sourceCardId: cards[2].id,
      assignee: "Команда",
    });
    await advanceRevision(context, actionResult);

    const exportedAt = new Date("2026-07-31T12:34:56.789Z");
    const beforeExport = context.revision;
    const exported = await getTargetBoardExport(context.id, context.ownerPayload, {
      exportedAt,
    });
    assert.equal(await getBoardRevision(context.id), beforeExport);
    assert.deepEqual(
      Object.keys(exported).sort(),
      ["actionItems", "board", "columns", "exportedAt", "schemaVersion"].sort(),
    );
    assert.equal(exported.schemaVersion, 2);
    assert.equal(exported.exportedAt, exportedAt.toISOString());
    assert.equal(exported.board.id, context.id);
    assert.equal("revision" in exported, false);
    assert.equal("revision" in exported.board, false);
    assert.equal(exported.columns.length, 2);
    assert.deepEqual(
      exported.columns.map((column) => column.id),
      context.columns.map((column) => column.id),
    );
    assert.equal(
      exported.columns.find((column) => column.id === emptyColumn.id).items.length,
      0,
    );
    const sourceExport = exported.columns.find((column) => column.id === sourceColumn.id);
    assert.ok(sourceExport);
    const exportedGroup = sourceExport.items.find((item) => item.kind === "GROUP");
    assert.ok(exportedGroup);
    assert.equal(exportedGroup.id, groupResult.group.id);
    assert.equal(exportedGroup.primaryCardId, cards[1].id);
    assert.equal(exportedGroup.voteCount, 1);
    assert.deepEqual(
      new Set(exportedGroup.cards.map((card) => card.id)),
      new Set([cards[0].id, cards[1].id]),
    );
    assert.deepEqual(exportedGroup.cards.map((card) => card.position), [1024, 2048]);
    assert.equal(exported.actionItems.length, 1);
    assert.equal(exported.actionItems[0].id, actionResult.actionItem.id);
    assert.equal(exported.actionItems[0].sourceCardId, cards[2].id);
    assertNoPrivateKeys(exported);

    await assert.rejects(
      () => getTargetBoardExport(context.id, context.ownerPayload, {
        env: { ...process.env, BOARD_CARD_LIMIT: "1" },
        exportedAt,
      }),
      (error) => {
        assert.equal(error?.code, "BOARD_EXPORT_LIMIT_EXCEEDED");
        assert.equal(error?.details?.cardLimit, 1);
        assert.ok(error?.details?.voteLimit > 1);
        return true;
      },
    );
    assert.equal(await getBoardRevision(context.id), beforeExport);
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("placement validation distinguishes foreign resources from stale adjacency", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const ownerPayload = createVisitorPayload();
  try {
    const context = await setupBoard(fixture, "Placement board", ownerPayload);
    const foreignContext = await setupBoard(fixture, "Foreign placement board", ownerPayload);
    const [firstColumn, secondColumn] = context.columns;

    const thirdResult = await createBoardColumn(context.id, context.ownerPayload, {
      title: "Третья",
      voteLimit: 3,
      placement: { beforeColumnId: secondColumn.id, afterColumnId: null },
      expectedRevision: context.revision.toString(),
    });
    await advanceRevision(context, thirdResult);
    const fourthResult = await createBoardColumn(context.id, context.ownerPayload, {
      title: "Четвёртая",
      voteLimit: 3,
      placement: { beforeColumnId: thirdResult.column.id, afterColumnId: null },
      expectedRevision: context.revision.toString(),
    });
    await advanceRevision(context, fourthResult);

    await assert.rejects(
      () => createBoardColumn(context.id, context.ownerPayload, {
        title: "Foreign anchor",
        voteLimit: 3,
        placement: {
          beforeColumnId: foreignContext.columns[0].id,
          afterColumnId: null,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("COLUMN_NOT_FOUND"),
    );
    await assert.rejects(
      () => createBoardColumn(context.id, context.ownerPayload, {
        title: "Nonadjacent anchors",
        voteLimit: 3,
        placement: {
          beforeColumnId: firstColumn.id,
          afterColumnId: thirdResult.column.id,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("STALE_BOARD_REVISION"),
    );
    await assert.rejects(
      () => moveBoardColumn(context.id, secondColumn.id, context.ownerPayload, {
        placement: {
          beforeColumnId: foreignContext.columns[0].id,
          afterColumnId: null,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("COLUMN_NOT_FOUND"),
    );
    await assert.rejects(
      () => moveBoardColumn(context.id, secondColumn.id, context.ownerPayload, {
        placement: {
          beforeColumnId: secondColumn.id,
          afterColumnId: thirdResult.column.id,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("STALE_BOARD_REVISION"),
    );
    await assert.rejects(
      () => moveBoardColumn(context.id, fourthResult.column.id, context.ownerPayload, {
        placement: {
          beforeColumnId: firstColumn.id,
          afterColumnId: thirdResult.column.id,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("STALE_BOARD_REVISION"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);

    const actionItems = [];
    for (let index = 0; index < 4; index += 1) {
      actionItems.push(await createManualAction(context, `Action ${index + 1}`));
    }
    const foreignAction = await createManualAction(foreignContext, "Foreign action");
    const orderedActions = await prisma.actionItem.findMany({
      where: { boardId: context.id },
      orderBy: [{ position: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    const actionSource = orderedActions.at(-1);
    await assert.rejects(
      () => moveActionItem(context.id, actionSource.id, context.ownerPayload, {
        placement: {
          beforeActionItemId: foreignAction.id,
          afterActionItemId: null,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("ACTION_ITEM_NOT_FOUND"),
    );
    await assert.rejects(
      () => moveActionItem(context.id, actionSource.id, context.ownerPayload, {
        placement: {
          beforeActionItemId: actionSource.id,
          afterActionItemId: null,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("STALE_BOARD_REVISION"),
    );
    await assert.rejects(
      () => moveActionItem(context.id, actionSource.id, context.ownerPayload, {
        placement: {
          beforeActionItemId: orderedActions[0].id,
          afterActionItemId: orderedActions[2].id,
        },
        expectedRevision: context.revision.toString(),
      }),
      hasCode("STALE_BOARD_REVISION"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);

    const cards = [];
    for (let index = 0; index < 6; index += 1) {
      cards.push(await createCard(context, firstColumn.id, `Placement card ${index + 1}`));
    }
    const groupResult = await createCardGroup(
      context.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        columnId: firstColumn.id,
        cardIds: [cards[0].id, cards[1].id],
        primaryCardId: cards[0].id,
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, groupResult);

    const foreignCards = [
      await createCard(
        foreignContext,
        foreignContext.columns[0].id,
        "Foreign placement card 1",
      ),
      await createCard(
        foreignContext,
        foreignContext.columns[0].id,
        "Foreign placement card 2",
      ),
      await createCard(
        foreignContext,
        foreignContext.columns[0].id,
        "Foreign placement card 3",
      ),
    ];
    const foreignGroupResult = await createCardGroup(
      foreignContext.id,
      foreignContext.ownerPayload,
      foreignContext.ownerIdentity,
      {
        columnId: foreignContext.columns[0].id,
        cardIds: [foreignCards[0].id, foreignCards[1].id],
        primaryCardId: foreignCards[0].id,
        expectedRevision: foreignContext.revision.toString(),
      },
    );
    await advanceRevision(foreignContext, foreignGroupResult);

    const [page, foreignPage] = await Promise.all([
      getTopLevelPage(context, firstColumn.id),
      getTopLevelPage(foreignContext, foreignContext.columns[0].id),
    ]);
    const cardSource = page.items.filter((item) => item.kind === "CARD").at(-1);
    const groupSource = page.items.find((item) => item.kind === "GROUP");
    const foreignCard = foreignPage.items.find((item) => item.kind === "CARD");
    const foreignGroup = foreignPage.items.find((item) => item.kind === "GROUP");
    assert.ok(cardSource && groupSource && foreignCard && foreignGroup);

    for (const [reference, code] of [
      [itemRef(foreignCard), "CARD_NOT_FOUND"],
      [itemRef(foreignGroup), "GROUP_NOT_FOUND"],
    ]) {
      await assert.rejects(
        () => moveTargetCard(
          context.id,
          cardSource.id,
          context.ownerPayload,
          context.ownerIdentity,
          {
            targetColumnId: firstColumn.id,
            placement: { before: reference, after: null },
            expectedRevision: context.revision.toString(),
          },
        ),
        hasCode(code),
      );
    }
    await assert.rejects(
      () => moveTargetCard(
        context.id,
        cardSource.id,
        context.ownerPayload,
        context.ownerIdentity,
        {
          targetColumnId: firstColumn.id,
          placement: { before: itemRef(cardSource), after: null },
          expectedRevision: context.revision.toString(),
        },
      ),
      hasCode("STALE_BOARD_REVISION"),
    );
    const cardRemaining = page.items.filter((item) => item.id !== cardSource.id);
    await assert.rejects(
      () => moveTargetCard(
        context.id,
        cardSource.id,
        context.ownerPayload,
        context.ownerIdentity,
        {
          targetColumnId: firstColumn.id,
          placement: { before: itemRef(cardRemaining[0]), after: itemRef(cardRemaining[2]) },
          expectedRevision: context.revision.toString(),
        },
      ),
      hasCode("STALE_BOARD_REVISION"),
    );

    for (const [reference, code] of [
      [itemRef(foreignGroup), "GROUP_NOT_FOUND"],
      [itemRef(foreignCard), "CARD_NOT_FOUND"],
    ]) {
      await assert.rejects(
        () => moveCardGroup(
          context.id,
          groupSource.id,
          context.ownerPayload,
          context.ownerIdentity,
          {
            targetColumnId: firstColumn.id,
            placement: { before: reference, after: null },
            expectedRevision: context.revision.toString(),
          },
        ),
        hasCode(code),
      );
    }
    await assert.rejects(
      () => moveCardGroup(
        context.id,
        groupSource.id,
        context.ownerPayload,
        context.ownerIdentity,
        {
          targetColumnId: firstColumn.id,
          placement: { before: itemRef(groupSource), after: null },
          expectedRevision: context.revision.toString(),
        },
      ),
      hasCode("STALE_BOARD_REVISION"),
    );
    const groupRemaining = page.items.filter((item) => item.id !== groupSource.id);
    await assert.rejects(
      () => moveCardGroup(
        context.id,
        groupSource.id,
        context.ownerPayload,
        context.ownerIdentity,
        {
          targetColumnId: firstColumn.id,
          placement: { before: itemRef(groupRemaining[0]), after: itemRef(groupRemaining[2]) },
          expectedRevision: context.revision.toString(),
        },
      ),
      hasCode("STALE_BOARD_REVISION"),
    );
    assert.equal(await getBoardRevision(context.id), context.revision);
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("read-only takes precedence over owner-only errors for participant mutations", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  const participantPayload = createVisitorPayload();
  fixture.visitorPayloads.push(participantPayload);
  try {
    const context = await setupBoard(fixture, "Read-only precedence");
    const [sourceColumn, targetColumn] = context.columns;
    const invitation = await createParticipantInvitation(context.id, context.ownerPayload);
    await redeemBoardInvitation(invitation.token, participantPayload, "Участник");
    const participantIdentity = identityFor(participantPayload, context.id);
    const cards = [
      await createCard(context, sourceColumn.id, "Read-only card 1"),
      await createCard(context, sourceColumn.id, "Read-only card 2"),
      await createCard(context, sourceColumn.id, "Read-only card 3"),
      await createCard(context, sourceColumn.id, "Read-only card 4"),
    ];
    const groupResult = await createCardGroup(
      context.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        columnId: sourceColumn.id,
        cardIds: [cards[0].id, cards[1].id],
        primaryCardId: cards[0].id,
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, groupResult);
    const actions = [
      await createManualAction(context, "Read-only action 1"),
      await createManualAction(context, "Read-only action 2"),
    ];
    const participantVote = await voteForCard(
      context.id,
      cards[2].id,
      participantPayload,
      participantIdentity,
    );
    await advanceRevision(context, participantVote);
    const readOnly = await updateBoardSettings(context.id, context.ownerPayload, {
      readOnly: true,
    });
    await advanceRevision(context, readOnly);

    const operations = [
      () => createBoardColumn(context.id, participantPayload, {
        title: "Нельзя создать",
        voteLimit: 3,
        placement: { beforeColumnId: targetColumn.id, afterColumnId: null },
        expectedRevision: context.revision.toString(),
      }),
      () => moveBoardColumn(context.id, sourceColumn.id, participantPayload, {
        placement: { beforeColumnId: targetColumn.id, afterColumnId: null },
        expectedRevision: context.revision.toString(),
      }),
      () => createCardGroup(
        context.id,
        participantPayload,
        participantIdentity,
        {
          columnId: sourceColumn.id,
          cardIds: [cards[2].id, cards[3].id],
          primaryCardId: cards[2].id,
          expectedRevision: context.revision.toString(),
        },
      ),
      () => moveCardGroup(
        context.id,
        groupResult.group.id,
        participantPayload,
        participantIdentity,
        {
          targetColumnId: targetColumn.id,
          placement: { before: null, after: null },
          expectedRevision: context.revision.toString(),
        },
      ),
      () => createActionItem(context.id, participantPayload, {
        source: "manual",
        text: "Нельзя создать action",
      }),
      () => moveActionItem(context.id, actions[0].id, participantPayload, {
        placement: {
          beforeActionItemId: actions[1].id,
          afterActionItemId: null,
        },
        expectedRevision: context.revision.toString(),
      }),
      () => resetBoardVotes(context.id, participantPayload, context.revision.toString()),
    ];
    for (const operation of operations) {
      await assert.rejects(operation, hasCode("BOARD_READ_ONLY"));
      assert.equal(await getBoardRevision(context.id), context.revision);
    }
    assert.equal(await prisma.vote.count({ where: { boardId: context.id } }), 1);
    assert.equal(await prisma.cardGroup.count({ where: { boardId: context.id } }), 1);
    assert.equal(await prisma.actionItem.count({ where: { boardId: context.id } }), 2);
    assert.equal(await prisma.boardColumn.count({ where: { boardId: context.id } }), 2);
  } finally {
    await cleanupFixture(fixture);
  }
});

databaseTest("groups count unique voters, display the primary text, and create actions", async () => {
  const fixture = { boardIds: [], visitorPayloads: [] };
  try {
    const context = await setupBoard(fixture, "Поведение групп");
    const sourceColumn = context.columns[0];
    const cards = [
      await createCard(context, sourceColumn.id, "Первичный сигнал"),
      await createCard(context, sourceColumn.id, "Основной сигнал"),
    ];

    for (const card of cards) {
      const vote = await voteForCard(
        context.id,
        card.id,
        context.ownerPayload,
        context.ownerIdentity,
      );
      await advanceRevision(context, vote);
    }

    const groupResult = await createCardGroup(
      context.id,
      context.ownerPayload,
      context.ownerIdentity,
      {
        columnId: sourceColumn.id,
        cardIds: cards.map((card) => card.id),
        primaryCardId: cards[1].id,
        title: null,
        expectedRevision: context.revision.toString(),
      },
    );
    await advanceRevision(context, groupResult);
    assert.equal(groupResult.group.voteCount, 1);
    assert.equal(groupResult.group.title, null);

    const page = await getTopLevelPage(context, sourceColumn.id);
    const pageGroup = page.items.find((item) => item.kind === "GROUP");
    assert.ok(pageGroup);
    assert.equal(pageGroup.voteCount, 1);
    assert.equal(
      pageGroup.cards.find((card) => card.id === pageGroup.primaryCardId)?.text,
      cards[1].text,
    );

    const fallbackAction = await createActionItem(context.id, context.ownerPayload, {
      source: "group",
      sourceGroupId: groupResult.group.id,
    });
    await advanceRevision(context, fallbackAction);
    assert.equal(fallbackAction.actionItem.text, cards[1].text);
    assert.equal(fallbackAction.actionItem.sourceCardId, cards[1].id);

    const titledGroup = await updateCardGroup(
      context.id,
      groupResult.group.id,
      context.ownerPayload,
      context.ownerIdentity,
      { title: "Общий вывод" },
    );
    await advanceRevision(context, titledGroup);
    assert.equal(titledGroup.group.voteCount, 1);

    const titledAction = await createActionItem(context.id, context.ownerPayload, {
      source: "group",
      sourceGroupId: groupResult.group.id,
    });
    await advanceRevision(context, titledAction);
    assert.equal(titledAction.actionItem.text, "Общий вывод");

    const exported = await getTargetBoardExport(context.id, context.ownerPayload);
    const exportedGroup = exported.columns
      .flatMap((column) => column.items)
      .find((item) => item.kind === "GROUP");
    assert.ok(exportedGroup);
    assert.equal(exportedGroup.voteCount, 1);
    assert.equal(exportedGroup.title, "Общий вывод");
  } finally {
    await cleanupFixture(fixture);
  }
});

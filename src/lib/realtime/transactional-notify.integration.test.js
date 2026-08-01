import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { deriveSessionCredentialHash } from "../access/session-service.ts";
import { prisma } from "../prisma/client.ts";
import { createTargetBoard, updateBoardSettings } from "../services/board-settings-service.ts";
import { incrementBoardRevision } from "../services/content-service-helpers.ts";
import { BOARD_EVENT_CHANNEL, parseBoardMutationEvent } from "./board-events.ts";

const databaseTest = process.env.RUN_DATABASE_TESTS === "1" ? test : test.skip;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const waitForEventCount = async (events, count, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs;
  while (events.length < count && Date.now() < deadline) {
    await wait(10);
  }
  assert.equal(events.length, count, `expected ${count} committed notification(s)`);
};

databaseTest("board revision and PostgreSQL notification commit atomically", async () => {
  const visitorPayload = randomBytes(32).toString("base64url");
  const board = await createTargetBoard(visitorPayload, "Realtime transaction test");
  const listener = new Client({ connectionString: process.env.DATABASE_URL });
  const events = [];

  try {
    await listener.connect();
    await listener.query(`LISTEN ${BOARD_EVENT_CHANNEL}`);
    listener.on("notification", (notification) => {
      if (notification.channel !== BOARD_EVENT_CHANNEL || !notification.payload) {
        return;
      }
      const event = parseBoardMutationEvent(notification.payload);
      if (event?.boardId === board.id) {
        events.push(event);
      }
    });

    let releaseTransaction;
    const transactionGate = new Promise((resolve) => {
      releaseTransaction = resolve;
    });
    let markNotificationQueued;
    const notificationQueued = new Promise((resolve) => {
      markNotificationQueued = resolve;
    });
    const committedRevision = prisma.$transaction(async (tx) => {
      const revision = await incrementBoardRevision(tx, board.id, "board.updated");
      markNotificationQueued();
      await transactionGate;
      return revision;
    });

    await notificationQueued;
    await wait(50);
    assert.equal(events.length, 0, "NOTIFY must remain invisible before commit");
    releaseTransaction();
    assert.equal(await committedRevision, 1n);
    await waitForEventCount(events, 1);
    assert.deepEqual(events[0], {
      boardId: board.id,
      revision: "1",
      type: "board.updated",
    });

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        await incrementBoardRevision(tx, board.id, "card.created");
        throw new Error("rollback notification test");
      }),
      /rollback notification test/,
    );
    await wait(50);
    assert.equal(events.length, 1, "rolled back NOTIFY must not be delivered");
    assert.equal(
      (await prisma.board.findUniqueOrThrow({
        where: { id: board.id },
        select: { revision: true },
      })).revision,
      1n,
    );

    const updated = await updateBoardSettings(board.id, visitorPayload, {
      title: "Realtime mapping test",
    });
    assert.equal(updated.revision, "2");
    await waitForEventCount(events, 2);
    assert.deepEqual(events[1], {
      boardId: board.id,
      revision: "2",
      type: "board.updated",
    });

    const noOp = await updateBoardSettings(board.id, visitorPayload, {
      title: " Realtime mapping test ",
    });
    assert.equal(noOp.revision, "2");
    await wait(50);
    assert.equal(events.length, 2, "no-op mutation must not send a notification");
  } finally {
    await listener.end().catch(() => undefined);
    await prisma.board.deleteMany({ where: { id: board.id } });
    await prisma.anonymousSession.deleteMany({
      where: { credentialHash: deriveSessionCredentialHash(visitorPayload) },
    });
  }
});

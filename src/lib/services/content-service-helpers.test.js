import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  MAX_POSITION,
  MIN_POSITION,
  POSITION_STEP,
  assertContentVisitorIdentity,
  comparePositionedItems,
  deriveContentVisitorIdentity,
  isRetryableContentTransactionError,
  parseRevision,
  positionForInsertion,
  requireContentVisitorIdentity,
  requireExpectedRevision,
  resolveIdPlacementIndex,
  resolveItemPlacementIndex,
  serializeRevision,
} from "./content-service-helpers.ts";
import {
  allocateHeadPosition,
  allocateTopLevelPosition,
  materializeTopLevelItemMove,
  rebalanceTopLevelItems,
} from "./top-level-order.ts";

const knownPrismaError = (code, meta) => new Prisma.PrismaClientKnownRequestError(
  "test database error",
  { code, clientVersion: "test", meta },
);

const boardAtRevision = (revision) => ({ revision });
const card = (id, position) => ({ kind: "CARD", id, position });
const group = (id, position) => ({ kind: "GROUP", id, position });
const ref = ({ kind, id }) => ({ kind, id });

const createPositionTransaction = () => {
  const updates = [];
  return {
    updates,
    tx: {
      card: {
        update: async ({ where, data }) => {
          updates.push({ kind: "CARD", id: where.id, position: data.position });
        },
      },
      cardGroup: {
        update: async ({ where, data }) => {
          updates.push({ kind: "GROUP", id: where.id, position: data.position });
        },
      },
    },
  };
};

test("revision helpers accept only canonical non-negative decimal strings", () => {
  const largeRevision = "18446744073709551616000000000000000000";
  assert.equal(parseRevision("0"), 0n);
  assert.equal(parseRevision("42"), 42n);
  assert.equal(serializeRevision(parseRevision(largeRevision)), largeRevision);

  for (const invalid of ["", "00", "01", "-1", "+1", "1.0", " 1", "1 ", "1e3"]) {
    assert.throws(() => parseRevision(invalid), {
      name: "RangeError",
      message: "revision must be a canonical non-negative decimal string",
    });
  }
});

test("expected revision reports the current board revision on a stale mutation", () => {
  assert.doesNotThrow(() => requireExpectedRevision(boardAtRevision(7n), "7"));
  assert.throws(
    () => requireExpectedRevision(boardAtRevision(7n), "6"),
    (error) => {
      assert.equal(error.status, 409);
      assert.equal(error.code, "STALE_BOARD_REVISION");
      assert.deepEqual(error.details, { currentRevision: "7" });
      return true;
    },
  );
});

test("content transaction retry recognizes only expected transaction SQLSTATEs", () => {
  assert.equal(isRetryableContentTransactionError(knownPrismaError("P2034")), true);
  assert.equal(
    isRetryableContentTransactionError(knownPrismaError("P2010", { code: "40001" })),
    true,
  );
  assert.equal(
    isRetryableContentTransactionError(knownPrismaError("P2010", { code: "40P01" })),
    true,
  );
  assert.equal(
    isRetryableContentTransactionError(knownPrismaError("P2010", {
      driverAdapterError: {
        cause: {
          kind: "TransactionWriteConflict",
          originalCode: "40001",
        },
      },
    })),
    true,
  );

  assert.equal(
    isRetryableContentTransactionError(knownPrismaError("P2010", { code: "23505" })),
    false,
  );
  assert.equal(isRetryableContentTransactionError(knownPrismaError("P2002")), false);
  assert.equal(isRetryableContentTransactionError({ code: "40001" }), true);
  assert.equal(isRetryableContentTransactionError({ code: "40P01" }), true);
  assert.equal(isRetryableContentTransactionError({ code: "P2002" }), false);
});

test("content visitor identities are stable board-scoped 43-character HMACs", () => {
  const env = {
    NODE_ENV: "test",
    VISITOR_TOKEN_SECRET: "stage1-test-visitor-secret-with-32-bytes",
  };
  const payload = "raw-cookie-payload-must-never-be-persisted";
  const boardId = "00000000-0000-4000-8000-000000000001";
  const identity = deriveContentVisitorIdentity(boardId, payload, env);

  assert.match(identity, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(deriveContentVisitorIdentity(boardId, payload, env), identity);
  assert.notEqual(
    deriveContentVisitorIdentity("00000000-0000-4000-8000-000000000002", payload, env),
    identity,
  );
  assert.notEqual(identity, payload);
  assert.doesNotThrow(() => assertContentVisitorIdentity(identity));
  assert.equal(requireContentVisitorIdentity(boardId, payload, identity, env), identity);
  assert.throws(
    () => assertContentVisitorIdentity(payload),
    /43-character base64url HMAC/,
  );
  assert.throws(
    () => requireContentVisitorIdentity(boardId, "A".repeat(43), "A".repeat(43), env),
    /does not match the board-scoped visitor HMAC/,
  );
});

test("item placement accepts empty, head, adjacent, and tail anchors", () => {
  const items = [card("card-a", 100), group("group-b", 200), card("card-c", 300)];

  assert.equal(resolveItemPlacementIndex([], null, null), 0);
  assert.equal(resolveItemPlacementIndex([], ref(items[0]), null), null);
  assert.equal(resolveItemPlacementIndex(items, null, ref(items[0])), 0);
  assert.equal(resolveItemPlacementIndex(items, ref(items[0]), ref(items[1])), 1);
  assert.equal(resolveItemPlacementIndex(items, ref(items[2]), null), 3);

  assert.equal(resolveItemPlacementIndex(items, ref(items[0]), ref(items[2])), null);
  assert.equal(resolveItemPlacementIndex(items, { kind: "GROUP", id: "card-a" }, ref(items[1])), null);
  assert.equal(resolveItemPlacementIndex(items, { kind: "CARD", id: "missing" }, ref(items[1])), null);
  assert.equal(resolveItemPlacementIndex(items, null, ref(items[1])), null);
  assert.equal(resolveItemPlacementIndex(items, ref(items[1]), null), null);
});

test("ID placement rejects stale and non-adjacent anchors", () => {
  const ids = ["a", "b", "c"];

  assert.equal(resolveIdPlacementIndex([], null, null), 0);
  assert.equal(resolveIdPlacementIndex(ids, null, "a"), 0);
  assert.equal(resolveIdPlacementIndex(ids, "a", "b"), 1);
  assert.equal(resolveIdPlacementIndex(ids, "c", null), 3);
  assert.equal(resolveIdPlacementIndex(ids, "a", "c"), null);
  assert.equal(resolveIdPlacementIndex(ids, "missing", "b"), null);
  assert.equal(resolveIdPlacementIndex(ids, null, "b"), null);
  assert.equal(resolveIdPlacementIndex(ids, "b", null), null);
});

test("position allocation handles empty, edge, middle, and exhausted ranges", () => {
  assert.equal(positionForInsertion([], 0), POSITION_STEP);
  assert.equal(positionForInsertion([POSITION_STEP], 0), 0);
  assert.equal(positionForInsertion([POSITION_STEP], 1), POSITION_STEP * 2);
  assert.equal(positionForInsertion([100, 200], 1), 150);
  assert.equal(positionForInsertion([100, 101], 1), null);
  assert.equal(positionForInsertion([MIN_POSITION], 0), null);
  assert.equal(positionForInsertion([MAX_POSITION], 1), null);
});

test("positioned items have a deterministic position-kind-id order", () => {
  const items = [
    group("b", 10),
    card("z", 10),
    card("a", 10),
    group("a", 5),
  ];
  assert.deepEqual(items.sort(comparePositionedItems), [
    group("a", 5),
    card("a", 10),
    card("z", 10),
    group("b", 10),
  ]);
});

test("top-level rebalance updates only changed card and group positions", async () => {
  const { tx, updates } = createPositionTransaction();
  const result = await rebalanceTopLevelItems(tx, [
    card("card-a", POSITION_STEP),
    group("group-b", POSITION_STEP + 1),
    card("card-c", POSITION_STEP * 3),
  ]);

  assert.deepEqual(result.map((item) => item.position), [1024, 2048, 3072]);
  assert.deepEqual(updates, [
    { kind: "GROUP", id: "group-b", position: 2048 },
  ]);
});

test("materialized move preserves vote order around the dragged card", async () => {
  const sourceColumnId = "source-column";
  const targetColumnId = "target-column";
  const cards = [
    { ...card("card-a", 1024), columnId: sourceColumnId, voteCount: 1 },
    { ...card("card-b", 2048), columnId: sourceColumnId, voteCount: 5 },
    { ...card("card-c", 1024), columnId: targetColumnId, voteCount: 3 },
    { ...card("card-d", 2048), columnId: targetColumnId, voteCount: 0 },
  ];
  const updates = [];
  const tx = {
    card: {
      findMany: async ({ where, select }) => {
        const selected = cards.filter(
          (item) =>
            item.columnId === where.columnId &&
            (!where.id?.in || where.id.in.includes(item.id)),
        );
        return select._count
          ? selected.map((item) => ({
              id: item.id,
              _count: { votes: item.voteCount },
            }))
          : selected.map((item) => ({ id: item.id, position: item.position }));
      },
      update: async ({ where, data }) => {
        const item = cards.find((candidate) => candidate.id === where.id);
        item.position = data.position;
        updates.push({ id: where.id, position: data.position });
      },
    },
    cardGroup: {
      findMany: async () => [],
      update: async () => undefined,
    },
  };

  const position = await materializeTopLevelItemMove({
    tx,
    board: boardAtRevision(7n),
    boardId: "board-id",
    sourceColumnId,
    targetColumnId,
    movedItem: { kind: "CARD", id: "card-a" },
    placement: {
      before: { kind: "CARD", id: "card-c" },
      after: { kind: "CARD", id: "card-d" },
    },
    voteSortedColumnIds: [sourceColumnId],
  });

  assert.equal(position, 2048);
  assert.deepEqual(updates, [
    { id: "card-b", position: 1024 },
    { id: "card-a", position: 2048 },
    { id: "card-d", position: 3072 },
  ]);
});

test("materialized move rejects unrelated vote-sorted columns", async () => {
  await assert.rejects(
    () =>
      materializeTopLevelItemMove({
        tx: {},
        board: boardAtRevision(7n),
        boardId: "board-id",
        sourceColumnId: "source-column",
        targetColumnId: "target-column",
        movedItem: { kind: "CARD", id: "card-a" },
        placement: { before: null, after: null },
        voteSortedColumnIds: ["unrelated-column"],
      }),
    /source or target/,
  );
});

test("top-level allocation rebalances an exhausted gap and preserves placement", async () => {
  const { tx, updates } = createPositionTransaction();
  const items = [card("card-a", 100), group("group-b", 101)];
  const position = await allocateTopLevelPosition(
    tx,
    boardAtRevision(19n),
    items,
    { before: ref(items[0]), after: ref(items[1]) },
  );

  assert.equal(position, 1536);
  assert.deepEqual(updates, [
    { kind: "CARD", id: "card-a", position: 1024 },
    { kind: "GROUP", id: "group-b", position: 2048 },
  ]);
});

test("top-level allocation rejects stale placement anchors", async () => {
  const { tx } = createPositionTransaction();
  const items = [card("card-a", POSITION_STEP), group("group-b", POSITION_STEP * 2)];

  await assert.rejects(
    () => allocateTopLevelPosition(
      tx,
      boardAtRevision(23n),
      items,
      { before: ref(items[0]), after: null },
    ),
    (error) => {
      assert.equal(error.code, "STALE_BOARD_REVISION");
      assert.deepEqual(error.details, { currentRevision: "23" });
      return true;
    },
  );
});

test("head allocation rebalances when the minimum position is exhausted", async () => {
  const { tx, updates } = createPositionTransaction();
  const position = await allocateHeadPosition(tx, [
    card("card-a", MIN_POSITION),
    group("group-b", MIN_POSITION + 1),
  ]);

  assert.equal(position, 0);
  assert.deepEqual(updates, [
    { kind: "CARD", id: "card-a", position: 1024 },
    { kind: "GROUP", id: "group-b", position: 2048 },
  ]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeBoardItemsPage,
  mergeBoardRefresh,
} from "./board-state.ts";

const card = (id, position, overrides = {}) => ({
  kind: "CARD",
  id,
  columnId: "00000000-0000-4000-8000-000000000010",
  text: id,
  author: null,
  position,
  voteCount: 0,
  viewerHasVoted: false,
  canEdit: true,
  canDelete: true,
  canMove: true,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  ...overrides,
});

const group = (id, position, cards = []) => ({
  kind: "GROUP",
  id,
  columnId: "00000000-0000-4000-8000-000000000010",
  position,
  title: null,
  primaryCardId: cards[0]?.id ?? "00000000-0000-4000-8000-000000000099",
  voteCount: 0,
  viewerHasVoted: false,
  canMove: true,
  canUngroup: true,
  cards,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
});

const board = ({
  revision = "7",
  items = [],
  totalCount = items.length,
  nextCursor = null,
  columns,
} = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  title: "Ретроспектива команды",
  revision,
  createdAt: "2026-07-31T00:00:00.000Z",
  expiresAt: "2026-10-29T00:00:00.000Z",
  settings: {
    cardsEnabled: true,
    votingEnabled: true,
    readOnly: false,
  },
  viewer: {
    role: "OWNER",
    displayName: "Владелец",
  },
  capabilities: {
    canManageSettings: true,
    canManageAccess: true,
    canManageColumns: true,
    canManageGroups: true,
    canManageActionItems: true,
    canResetVotes: true,
    canDeleteBoard: true,
    canLeaveBoard: false,
    canCreateCards: true,
    canVote: true,
  },
  columns: columns ?? [{
    id: "00000000-0000-4000-8000-000000000010",
    title: "Уже хорошо",
    position: 1024,
    voteLimit: 3,
    items,
    totalCount,
    nextCursor,
  }],
  remainingVotesByColumn: {
    "00000000-0000-4000-8000-000000000010": 3,
  },
  actionItems: [],
});

test("poll refresh preserves traversed pages while revision is unchanged", () => {
  const head = card("00000000-0000-4000-8000-000000000021", 1024);
  const tail = card("00000000-0000-4000-8000-000000000022", 2048);
  const current = board({ items: [head, tail], totalCount: 4, nextCursor: "cursor-two" });
  const incoming = board({ items: [head], totalCount: 4, nextCursor: "cursor-one" });

  const merged = mergeBoardRefresh(current, incoming);

  assert.equal(merged, current);
  assert.deepEqual(merged.columns[0].items.map((item) => item.id), [head.id, tail.id]);
  assert.equal(merged.columns[0].nextCursor, "cursor-two");
});

test("poll refresh replaces loaded pages and removed columns when revision changes", () => {
  const oldCard = card("00000000-0000-4000-8000-000000000021", 1024);
  const current = board({
    revision: "7",
    columns: [
      ...board({ items: [oldCard] }).columns,
      {
        id: "00000000-0000-4000-8000-000000000011",
        title: "Удалённая колонка",
        position: 2048,
        voteLimit: 0,
        items: [],
        totalCount: 0,
        nextCursor: null,
      },
    ],
  });
  const newCard = card("00000000-0000-4000-8000-000000000023", 1024);
  const incoming = board({ revision: "8", items: [newCard] });

  const merged = mergeBoardRefresh(current, incoming);

  assert.equal(merged, incoming);
  assert.equal(merged.columns.length, 1);
  assert.deepEqual(merged.columns[0].items.map((item) => item.id), [newCard.id]);
});

test("a current page merges BoardItem values by dynamic column id and target order", () => {
  const first = card("00000000-0000-4000-8000-000000000021", 1024);
  const tiedGroup = group("00000000-0000-4000-8000-000000000024", 2048, [
    card("00000000-0000-4000-8000-000000000025", 1024),
  ]);
  const tiedCard = card("00000000-0000-4000-8000-000000000023", 2048);
  const current = board({ items: [first], totalCount: 3, nextCursor: "page-one" });

  const merged = mergeBoardItemsPage(current, {
    columnId: current.columns[0].id,
    revision: current.revision,
    items: [tiedGroup, tiedCard],
    totalCount: 3,
    nextCursor: null,
  }, "page-one");

  assert.deepEqual(merged.columns[0].items.map((item) => `${item.kind}:${item.id}`), [
    `CARD:${first.id}`,
    `CARD:${tiedCard.id}`,
    `GROUP:${tiedGroup.id}`,
  ]);
  assert.equal(merged.columns[0].nextCursor, null);
});

test("a page from an older revision is discarded", () => {
  const current = board({ revision: "8", nextCursor: "current-cursor", totalCount: 2 });
  const stalePage = {
    columnId: current.columns[0].id,
    revision: "7",
    items: [card("00000000-0000-4000-8000-000000000021", 2048)],
    totalCount: 2,
    nextCursor: null,
  };

  const merged = mergeBoardItemsPage(current, stalePage, "current-cursor");

  assert.equal(merged, current);
  assert.deepEqual(merged.columns[0].items, []);
});

test("a response for a superseded traversal cursor is discarded", () => {
  const current = board({ nextCursor: "newer-cursor", totalCount: 2 });
  const page = {
    columnId: current.columns[0].id,
    revision: current.revision,
    items: [card("00000000-0000-4000-8000-000000000021", 2048)],
    totalCount: 2,
    nextCursor: null,
  };

  const merged = mergeBoardItemsPage(current, page, "stale-cursor");

  assert.equal(merged, current);
  assert.deepEqual(merged.columns[0].items, []);
});

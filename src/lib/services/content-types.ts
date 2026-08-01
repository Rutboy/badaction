export type Revision = string;

declare const visitorIdentityBrand: unique symbol;

export type VisitorIdentity = string & {
  readonly [visitorIdentityBrand]: "board-scoped-visitor-identity";
};

export type BoardRole = "OWNER" | "PARTICIPANT";

export type BoardSettings = {
  cardsEnabled: boolean;
  votingEnabled: boolean;
  readOnly: boolean;
};

export type ItemRef = {
  kind: "CARD" | "GROUP";
  id: string;
};

export type ItemPlacement = {
  before: ItemRef | null;
  after: ItemRef | null;
};

export type ColumnPlacement = {
  beforeColumnId: string | null;
  afterColumnId: string | null;
};

export type ActionItemPlacement = {
  beforeActionItemId: string | null;
  afterActionItemId: string | null;
};

export type CardView = {
  kind: "CARD";
  id: string;
  columnId: string;
  text: string;
  author: string | null;
  position: number;
  voteCount: number;
  viewerHasVoted: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canMove: boolean;
  createdAt: string;
  updatedAt: string;
};

export type GroupView = {
  kind: "GROUP";
  id: string;
  columnId: string;
  position: number;
  title: string | null;
  primaryCardId: string;
  voteCount: number;
  viewerHasVoted: boolean;
  canMove: boolean;
  canUngroup: boolean;
  cards: CardView[];
  createdAt: string;
  updatedAt: string;
};

export type BoardItem = CardView | GroupView;

export type ColumnView = {
  id: string;
  title: string;
  position: number;
  voteLimit: number;
};

export type ActionItemView = {
  id: string;
  text: string;
  assignee: string | null;
  completed: boolean;
  position: number;
  sourceCardId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BoardCapabilities = {
  canManageSettings: boolean;
  canManageAccess: boolean;
  canManageColumns: boolean;
  canManageGroups: boolean;
  canManageActionItems: boolean;
  canResetVotes: boolean;
  canDeleteBoard: boolean;
  canLeaveBoard: boolean;
  canCreateCards: boolean;
  canVote: boolean;
};

export type BoardItemsPage = {
  columnId: string;
  revision: Revision;
  items: BoardItem[];
  totalCount: number;
  nextCursor: string | null;
};

export type BoardSnapshot = {
  id: string;
  title: string;
  revision: Revision;
  createdAt: string;
  expiresAt: string;
  settings: BoardSettings;
  viewer: {
    role: BoardRole;
    displayName: string;
  };
  capabilities: BoardCapabilities;
  columns: Array<ColumnView & {
    items: BoardItem[];
    totalCount: number;
    nextCursor: string | null;
  }>;
  remainingVotesByColumn: Record<string, number>;
  actionItems: ActionItemView[];
};

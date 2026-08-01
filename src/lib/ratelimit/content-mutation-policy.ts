export const CONTENT_JSON_BODY_LIMIT_BYTES = 16 * 1024;
export const CONTENT_MUTATION_INTERVAL_MS = 60 * 1000;
export const CONTENT_MUTATION_VISITOR_LIMIT = 30;
export const CONTENT_MUTATION_TRUSTED_IP_LIMIT = 300;

export const BOARD_CREATE_INTERVAL_MS = 10 * 60 * 1000;
export const BOARD_CREATE_VISITOR_LIMIT = 10;
export const BOARD_CREATE_TRUSTED_IP_LIMIT = 100;

export const VOTE_MUTATION_INTERVAL_MS = 60 * 1000;
export const VOTE_MUTATION_VISITOR_LIMIT = 20;
export const VOTE_MUTATION_TRUSTED_IP_LIMIT = 200;

export type ContentMutationName =
  | "board.create"
  | "board.update"
  | "column.create"
  | "column.update"
  | "column.move"
  | "column.delete"
  | "card.create"
  | "card.update"
  | "card.move"
  | "card.delete"
  | "vote.create"
  | "vote.delete"
  | "votes.reset"
  | "group.create"
  | "group.update"
  | "group.move"
  | "group.ungroup"
  | "action.create"
  | "action.update"
  | "action.move"
  | "action.delete";

export type ContentMutationPolicy = Readonly<{
  rateLimitScope: string;
  requestBody: "json" | "none";
  maxBodyBytes: number;
  visitorLimit: number;
  trustedIpLimit: number;
  intervalMs: number;
}>;

const jsonMutationPolicy = (rateLimitScope: string): ContentMutationPolicy => ({
  rateLimitScope,
  requestBody: "json",
  maxBodyBytes: CONTENT_JSON_BODY_LIMIT_BYTES,
  visitorLimit: CONTENT_MUTATION_VISITOR_LIMIT,
  trustedIpLimit: CONTENT_MUTATION_TRUSTED_IP_LIMIT,
  intervalMs: CONTENT_MUTATION_INTERVAL_MS,
});

const bodylessVotePolicy = (rateLimitScope: string): ContentMutationPolicy => ({
  rateLimitScope,
  requestBody: "none",
  maxBodyBytes: 0,
  visitorLimit: VOTE_MUTATION_VISITOR_LIMIT,
  trustedIpLimit: VOTE_MUTATION_TRUSTED_IP_LIMIT,
  intervalMs: VOTE_MUTATION_INTERVAL_MS,
});

export const CONTENT_MUTATION_POLICIES = {
  "board.create": {
    rateLimitScope: "create-board",
    requestBody: "json",
    maxBodyBytes: CONTENT_JSON_BODY_LIMIT_BYTES,
    visitorLimit: BOARD_CREATE_VISITOR_LIMIT,
    trustedIpLimit: BOARD_CREATE_TRUSTED_IP_LIMIT,
    intervalMs: BOARD_CREATE_INTERVAL_MS,
  },
  "board.update": jsonMutationPolicy("update-board"),
  "column.create": jsonMutationPolicy("create-column"),
  "column.update": jsonMutationPolicy("update-column"),
  "column.move": jsonMutationPolicy("move-column"),
  "column.delete": jsonMutationPolicy("delete-column"),
  "card.create": jsonMutationPolicy("create-card"),
  "card.update": jsonMutationPolicy("update-card"),
  "card.move": jsonMutationPolicy("move-card"),
  "card.delete": jsonMutationPolicy("delete-card"),
  "vote.create": bodylessVotePolicy("create-vote"),
  "vote.delete": bodylessVotePolicy("delete-vote"),
  "votes.reset": jsonMutationPolicy("reset-votes"),
  "group.create": jsonMutationPolicy("create-group"),
  "group.update": jsonMutationPolicy("update-group"),
  "group.move": jsonMutationPolicy("move-group"),
  "group.ungroup": jsonMutationPolicy("ungroup"),
  "action.create": jsonMutationPolicy("create-action-item"),
  "action.update": jsonMutationPolicy("update-action-item"),
  "action.move": jsonMutationPolicy("move-action-item"),
  "action.delete": jsonMutationPolicy("delete-action-item"),
} as const satisfies Record<ContentMutationName, ContentMutationPolicy>;

export const getContentMutationPolicy = (
  mutation: ContentMutationName,
): ContentMutationPolicy => CONTENT_MUTATION_POLICIES[mutation];

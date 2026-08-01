import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_CREATE_INTERVAL_MS,
  BOARD_CREATE_TRUSTED_IP_LIMIT,
  BOARD_CREATE_VISITOR_LIMIT,
  CONTENT_JSON_BODY_LIMIT_BYTES,
  CONTENT_MUTATION_POLICIES,
  CONTENT_MUTATION_TRUSTED_IP_LIMIT,
  CONTENT_MUTATION_VISITOR_LIMIT,
  getContentMutationPolicy,
  VOTE_MUTATION_TRUSTED_IP_LIMIT,
  VOTE_MUTATION_VISITOR_LIMIT,
} from "./content-mutation-policy.ts";

const EXPECTED_MUTATIONS = [
  "board.create",
  "board.update",
  "column.create",
  "column.update",
  "column.move",
  "column.delete",
  "card.create",
  "card.update",
  "card.move",
  "card.delete",
  "vote.create",
  "vote.delete",
  "votes.reset",
  "group.create",
  "group.update",
  "group.move",
  "group.ungroup",
  "action.create",
  "action.update",
  "action.move",
  "action.delete",
];

test("defines one centralized policy for every target content mutation", () => {
  assert.deepEqual(Object.keys(CONTENT_MUTATION_POLICIES).sort(), EXPECTED_MUTATIONS.sort());

  for (const mutation of EXPECTED_MUTATIONS) {
    const policy = getContentMutationPolicy(mutation);
    assert.equal(policy.rateLimitScope.length > 0, true);
    assert.equal(Number.isInteger(policy.visitorLimit) && policy.visitorLimit > 0, true);
    assert.equal(Number.isInteger(policy.trustedIpLimit) && policy.trustedIpLimit > 0, true);
    assert.equal(Number.isInteger(policy.intervalMs) && policy.intervalMs > 0, true);
  }
});

test("uses the existing 16 KiB JSON baseline and rejects bodies on vote endpoints", () => {
  assert.equal(CONTENT_JSON_BODY_LIMIT_BYTES, 16_384);

  for (const [mutation, policy] of Object.entries(CONTENT_MUTATION_POLICIES)) {
    if (mutation === "vote.create" || mutation === "vote.delete") {
      assert.equal(policy.requestBody, "none");
      assert.equal(policy.maxBodyBytes, 0);
    } else {
      assert.equal(policy.requestBody, "json");
      assert.equal(policy.maxBodyBytes, CONTENT_JSON_BODY_LIMIT_BYTES);
    }
  }
});

test("preserves established board, card, and vote abuse caps", () => {
  const boardCreate = getContentMutationPolicy("board.create");
  assert.deepEqual(
    {
      visitorLimit: boardCreate.visitorLimit,
      trustedIpLimit: boardCreate.trustedIpLimit,
      intervalMs: boardCreate.intervalMs,
    },
    {
      visitorLimit: BOARD_CREATE_VISITOR_LIMIT,
      trustedIpLimit: BOARD_CREATE_TRUSTED_IP_LIMIT,
      intervalMs: BOARD_CREATE_INTERVAL_MS,
    },
  );

  const cardCreate = getContentMutationPolicy("card.create");
  assert.equal(cardCreate.visitorLimit, CONTENT_MUTATION_VISITOR_LIMIT);
  assert.equal(cardCreate.trustedIpLimit, CONTENT_MUTATION_TRUSTED_IP_LIMIT);

  for (const mutation of ["vote.create", "vote.delete"]) {
    const votePolicy = getContentMutationPolicy(mutation);
    assert.equal(votePolicy.visitorLimit, VOTE_MUTATION_VISITOR_LIMIT);
    assert.equal(votePolicy.trustedIpLimit, VOTE_MUTATION_TRUSTED_IP_LIMIT);
  }
});

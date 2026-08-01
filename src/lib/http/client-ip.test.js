import test from "node:test";
import assert from "node:assert/strict";
import {
  extractClientIp,
  getTrustedProxyRateLimitIdentity,
  getVisitorRateLimitIdentity,
  parseTrustedProxyHops,
} from "./client-ip.ts";

const VISITOR_PAYLOAD = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

test("does not trust forwarded headers by default", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.10" });

  assert.equal(extractClientIp(headers, 0), null);
});

test("selects the client immediately before the configured trusted proxy chain", () => {
  const headers = new Headers({
    "x-forwarded-for": "198.51.100.7, 203.0.113.8, 192.0.2.4",
  });

  assert.equal(extractClientIp(headers, 1), "192.0.2.4");
  assert.equal(extractClientIp(headers, 2), "203.0.113.8");
  assert.equal(extractClientIp(headers, 3), "198.51.100.7");
});

test("ignores spoofed prefixes but rejects an invalid address at the trust boundary", () => {
  const spoofedPrefix = new Headers({ "x-forwarded-for": "attacker, 192.0.2.4" });
  assert.equal(extractClientIp(spoofedPrefix, 1), "192.0.2.4");
  assert.equal(extractClientIp(spoofedPrefix, 2), null);
  assert.equal(extractClientIp(new Headers({ "x-forwarded-for": "192.0.2.4" }), 2), null);
});

test("rejects invalid trusted proxy configuration", () => {
  assert.throws(() => parseTrustedProxyHops("-1"), /TRUSTED_PROXY_HOPS/);
  assert.throws(() => parseTrustedProxyHops("11"), /TRUSTED_PROXY_HOPS/);
  assert.throws(() => parseTrustedProxyHops("one"), /TRUSTED_PROXY_HOPS/);
});

test("visitor rate-limit identities are HMACed and scoped", () => {
  const env = {
    NODE_ENV: "test",
    RATE_LIMIT_KEY_SECRET: "unit-test-rate-limit-secret",
  };
  const identity = getVisitorRateLimitIdentity(VISITOR_PAYLOAD, "board:one", env);

  assert.equal(identity, getVisitorRateLimitIdentity(VISITOR_PAYLOAD, "board:one", env));
  assert.doesNotMatch(identity, new RegExp(VISITOR_PAYLOAD));
  assert.notEqual(identity, getVisitorRateLimitIdentity(VISITOR_PAYLOAD, "board:two", env));
  assert.notEqual(
    identity,
    getVisitorRateLimitIdentity(`${VISITOR_PAYLOAD}B`, "board:one", env),
  );
});

test("trusted proxy IP identity is an optional, separately scoped HMAC", () => {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.10" });
  const env = {
    NODE_ENV: "test",
    TRUSTED_PROXY_HOPS: "1",
    RATE_LIMIT_KEY_SECRET: "unit-test-rate-limit-secret",
  };

  const identity = getTrustedProxyRateLimitIdentity(headers, "board:one", env);
  assert.equal(identity, getTrustedProxyRateLimitIdentity(headers, "board:one", env));
  assert.notEqual(identity, null);
  assert.doesNotMatch(identity, /203\.0\.113\.10/);
  assert.notEqual(
    identity,
    getTrustedProxyRateLimitIdentity(headers, "board:two", env),
  );
  assert.equal(
    getTrustedProxyRateLimitIdentity(headers, "board:one", {
      ...env,
      TRUSTED_PROXY_HOPS: "0",
    }),
    null,
  );
});

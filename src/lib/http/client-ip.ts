import { isIP } from "node:net";
import { getServerSecret, hmacSha256 } from "../security/hmac.ts";

const DEVELOPMENT_SECRET = "development-only-rate-limit-key-secret";
const MAX_TRUSTED_PROXY_HOPS = 10;
const VISITOR_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_IDENTITY_SCOPE_LENGTH = 256;

export const parseTrustedProxyHops = (value: string | undefined) => {
  if (value === undefined || value.trim() === "") {
    return 0;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("TRUSTED_PROXY_HOPS must be an integer between 0 and 10");
  }

  const hops = Number(value);
  if (!Number.isSafeInteger(hops) || hops > MAX_TRUSTED_PROXY_HOPS) {
    throw new Error("TRUSTED_PROXY_HOPS must be an integer between 0 and 10");
  }

  return hops;
};

export const extractClientIp = (requestHeaders: Headers, trustedProxyHops: number) => {
  if (trustedProxyHops === 0) {
    return null;
  }

  const forwardedFor = requestHeaders.get("x-forwarded-for");
  if (!forwardedFor) {
    return null;
  }

  const chain = forwardedFor.split(",").map((value) => value.trim());
  if (chain.length < trustedProxyHops) {
    return null;
  }

  // Only the address at the configured trust boundary is authoritative. Any
  // values farther left were supplied before the trusted proxy chain and may
  // be attacker-controlled; rejecting the whole header because of such a
  // prefix would let an attacker disable the secondary IP limit.
  const clientIp = chain[chain.length - trustedProxyHops];
  return clientIp && isIP(clientIp) !== 0 ? clientIp : null;
};

export const getRateLimitKeySecret = (env: NodeJS.ProcessEnv = process.env) =>
  getServerSecret({
    env,
    name: "RATE_LIMIT_KEY_SECRET",
    developmentFallback: DEVELOPMENT_SECRET,
  });

const assertIdentityScope = (scope: string) => {
  if (scope.length < 1 || scope.length > MAX_IDENTITY_SCOPE_LENGTH) {
    throw new Error(`Rate-limit identity scope must contain 1-${MAX_IDENTITY_SCOPE_LENGTH} characters`);
  }
};

export const getVisitorRateLimitIdentity = (
  visitorPayload: string,
  scope: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  if (!VISITOR_PAYLOAD_PATTERN.test(visitorPayload)) {
    throw new Error("A verified visitor token payload is required for rate limiting");
  }

  assertIdentityScope(scope);
  return hmacSha256(
    getRateLimitKeySecret(env),
    `rate-limit:visitor:${scope}:${visitorPayload}`,
  );
};

export const getTrustedProxyRateLimitIdentity = (
  requestHeaders: Headers,
  scope: string,
  env: NodeJS.ProcessEnv = process.env,
) => {
  assertIdentityScope(scope);
  const trustedProxyHops = parseTrustedProxyHops(env.TRUSTED_PROXY_HOPS);
  const clientIp = extractClientIp(requestHeaders, trustedProxyHops);
  if (!clientIp) {
    return null;
  }

  return hmacSha256(getRateLimitKeySecret(env), `rate-limit:ip:${scope}:${clientIp}`);
};

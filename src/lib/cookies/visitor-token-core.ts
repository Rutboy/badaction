import { randomBytes } from "node:crypto";
import { ANONYMOUS_CREDENTIAL_LIFETIME_DAYS } from "../constants/access.ts";
import { getServerSecret, hmacSha256, safeEqual } from "../security/hmac.ts";

const TOKEN_VERSION = "v2";
const DEVELOPMENT_SECRET = "development-only-visitor-token-secret";
const TOKEN_LIFETIME_MS = ANONYMOUS_CREDENTIAL_LIFETIME_DAYS * 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const getVisitorTokenSecret = (env: NodeJS.ProcessEnv = process.env) =>
  getServerSecret({
    env,
    name: "VISITOR_TOKEN_SECRET",
    developmentFallback: DEVELOPMENT_SECRET,
  });

const signPayload = (issuedAt: string, payload: string, secret: string) =>
  hmacSha256(secret, `${TOKEN_VERSION}.${issuedAt}.${payload}`);

export const createSignedVisitorToken = (
  secret: string,
  createRandomValue: () => string = () => randomBytes(32).toString("base64url"),
  now: number = Date.now(),
) => {
  const payload = createRandomValue();
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new RangeError("Visitor token timestamp must be a non-negative safe integer");
  }

  const issuedAt = now.toString(36);
  const signature = signPayload(issuedAt, payload, secret);

  return `${TOKEN_VERSION}.${issuedAt}.${payload}.${signature}`;
};

export const verifySignedVisitorTokenDetails = (
  value: string,
  secret: string,
  now: number = Date.now(),
) => {
  const [version, issuedAt, payload, signature, extra] = value.split(".");

  if (
    version !== TOKEN_VERSION ||
    !issuedAt ||
    !payload ||
    !signature ||
    extra !== undefined ||
    !/^[0-9a-z]+$/.test(issuedAt) ||
    !/^[A-Za-z0-9_-]{32,}$/.test(payload)
  ) {
    return null;
  }

  const issuedAtMilliseconds = Number.parseInt(issuedAt, 36);
  if (
    !Number.isSafeInteger(now)
    || !Number.isSafeInteger(issuedAtMilliseconds)
    || issuedAtMilliseconds < 0
    || issuedAtMilliseconds > now + MAX_CLOCK_SKEW_MS
    || now - issuedAtMilliseconds >= TOKEN_LIFETIME_MS
  ) {
    return null;
  }

  const expectedSignature = signPayload(issuedAt, payload, secret);
  return safeEqual(signature, expectedSignature)
    ? { payload, issuedAtMilliseconds }
    : null;
};

export const verifySignedVisitorToken = (
  value: string,
  secret: string,
  now: number = Date.now(),
) => verifySignedVisitorTokenDetails(value, secret, now)?.payload ?? null;

export const deriveBoardVisitorId = (payload: string, boardId: string, secret: string) =>
  hmacSha256(secret, `board:${boardId.toLowerCase()}\0visitor:${payload}`);

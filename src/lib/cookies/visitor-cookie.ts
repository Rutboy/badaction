import { ANONYMOUS_CREDENTIAL_LIFETIME_DAYS } from "../constants/access.ts";
import {
  createSignedVisitorToken,
  getVisitorTokenSecret,
  verifySignedVisitorTokenDetails,
} from "./visitor-token-core.ts";

export const VISITOR_COOKIE_NAME = "visitor_token";
const VISITOR_TOKEN_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export const getVisitorCookieOptions = (env: NodeJS.ProcessEnv = process.env) => ({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * ANONYMOUS_CREDENTIAL_LIFETIME_DAYS,
});

export const resolveVisitorCookie = (
  existingValue: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
) => {
  const secret = getVisitorTokenSecret(env);
  const verified = existingValue
    ? verifySignedVisitorTokenDetails(existingValue, secret, now)
    : null;

  if (verified) {
    const shouldRefresh = now - verified.issuedAtMilliseconds >= VISITOR_TOKEN_REFRESH_INTERVAL_MS;
    return {
      payload: verified.payload,
      cookieValueToSet: shouldRefresh
        ? createSignedVisitorToken(secret, () => verified.payload, now)
        : null,
      refreshesExistingCredential: shouldRefresh,
    };
  }

  const signedToken = createSignedVisitorToken(secret, undefined, now);
  const created = verifySignedVisitorTokenDetails(signedToken, secret, now);
  if (!created) {
    throw new Error("Failed to create visitor token");
  }

  return {
    payload: created.payload,
    cookieValueToSet: signedToken,
    refreshesExistingCredential: false,
  };
};

import { cookies } from "next/headers";
import {
  deriveBoardVisitorId,
  getVisitorTokenSecret,
  verifySignedVisitorToken,
} from "@/lib/cookies/visitor-token-core";
import {
  getVisitorCookieOptions,
  resolveVisitorCookie,
  VISITOR_COOKIE_NAME,
} from "@/lib/cookies/visitor-cookie";
import { preserveAnonymousSessionForCredentialRefresh } from "@/lib/access/session-service";

export const getOrSetVisitorToken = async () => {
  const cookieStore = await cookies();
  const resolved = resolveVisitorCookie(cookieStore.get(VISITOR_COOKIE_NAME)?.value);

  if (resolved.refreshesExistingCredential) {
    await preserveAnonymousSessionForCredentialRefresh(resolved.payload);
  }

  if (resolved.cookieValueToSet) {
    cookieStore.set(
      VISITOR_COOKIE_NAME,
      resolved.cookieValueToSet,
      getVisitorCookieOptions(),
    );
  }

  return resolved.payload;
};

export const getExistingVisitorToken = async (): Promise<string | null> => {
  const cookieStore = await cookies();
  const existing = cookieStore.get(VISITOR_COOKIE_NAME)?.value;
  return existing
    ? verifySignedVisitorToken(existing, getVisitorTokenSecret())
    : null;
};

export const getBoardVisitorIdFromPayload = (payload: string, boardId: string) => {
  return deriveBoardVisitorId(payload, boardId, getVisitorTokenSecret());
};

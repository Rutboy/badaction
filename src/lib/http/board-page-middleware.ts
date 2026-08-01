import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { requireActiveBoardMember } from "../access/acl-service.ts";
import { preserveAnonymousSessionForCredentialRefresh } from "../access/session-service.ts";
import {
  getVisitorCookieOptions,
  resolveVisitorCookie,
  VISITOR_COOKIE_NAME,
} from "../cookies/visitor-cookie.ts";
import { toErrorResponse } from "../errors/api-error.ts";
import { assertBoardReadRateLimits } from "../ratelimit/board-read-rate-limit.ts";
import { uuidParamSchema } from "../validators/common.ts";

type BoardReadRateLimiter = typeof assertBoardReadRateLimits;
type BoardAccessAuthorizer = typeof requireActiveBoardMember;
type CredentialRefreshPreserver =
  typeof preserveAnonymousSessionForCredentialRefresh;

const getBoardId = (request: NextRequest) => {
  const match = /^\/boards\/([^/]+)\/?$/.exec(request.nextUrl.pathname);
  if (!match) {
    return null;
  }

  let decodedBoardId: string;
  try {
    decodedBoardId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }

  const parsed = uuidParamSchema.safeParse(decodedBoardId);
  return parsed.success ? parsed.data : null;
};

const asNextResponse = (response: Response) =>
  new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

export const createBoardPageMiddleware = ({
  rateLimitBoardRead = assertBoardReadRateLimits,
  authorizeBoardAccess = requireActiveBoardMember,
  preserveCredentialRefresh = preserveAnonymousSessionForCredentialRefresh,
  env = process.env,
}: {
  rateLimitBoardRead?: BoardReadRateLimiter;
  authorizeBoardAccess?: BoardAccessAuthorizer;
  preserveCredentialRefresh?: CredentialRefreshPreserver;
  env?: NodeJS.ProcessEnv;
} = {}) => {
  return async (request: NextRequest) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return NextResponse.next();
    }

    const boardId = getBoardId(request);
    if (!boardId) {
      return NextResponse.next();
    }

    const visitor = resolveVisitorCookie(
      request.cookies.get(VISITOR_COOKIE_NAME)?.value,
      env,
    );

    let response: NextResponse;
    let credentialRefreshPreserved = !visitor.refreshesExistingCredential;
    try {
      if (visitor.refreshesExistingCredential) {
        await preserveCredentialRefresh(visitor.payload, { env });
        credentialRefreshPreserved = true;
      }
      await authorizeBoardAccess(boardId, visitor.payload, { env });
      await rateLimitBoardRead({
        boardId,
        headers: request.headers,
        visitorPayload: visitor.payload,
        env,
      });
      response = NextResponse.next();
    } catch (error) {
      response = asNextResponse(toErrorResponse(error));
    }

    if (visitor.cookieValueToSet && credentialRefreshPreserved) {
      response.cookies.set(
        VISITOR_COOKIE_NAME,
        visitor.cookieValueToSet,
        getVisitorCookieOptions(env),
      );
    }

    return response;
  };
};

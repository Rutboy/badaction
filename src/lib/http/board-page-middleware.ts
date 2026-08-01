import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { LOCALE_COOKIE_NAME } from "../../i18n/locales.ts";
import { resolveLocale } from "../../i18n/resolve-locale.ts";
import { createTranslator } from "../../i18n/translate.ts";
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

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );

export const localizeBoardPageErrorResponse = (
  request: NextRequest,
  errorResponse: Response,
): NextResponse => {
  const locale = resolveLocale({
    savedLocale: request.cookies.get(LOCALE_COOKIE_NAME)?.value,
    acceptLanguage: request.headers.get("accept-language"),
  });
  const t = createTranslator(locale);
  const status = errorResponse.status;
  const copy =
    status === 404
      ? {
          title: t("notFound.boardUnavailable"),
          description: t("notFound.boardDescription"),
        }
      : status === 503
        ? {
            title: t("serviceUnavailable.title"),
            description: t("serviceUnavailable.description"),
          }
        : status === 429
          ? {
              title: t("errorBoundary.title"),
              description: t("errors.api.RATE_LIMIT_EXCEEDED"),
            }
          : {
              title: t("errorBoundary.title"),
              description: t("errorBoundary.description"),
            };
  const headers = new Headers(errorResponse.headers);
  headers.set("Content-Language", locale);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");

  const body =
    request.method === "HEAD"
      ? null
      : `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
  <title>${escapeHtml(copy.title)}</title>
  <style>
    :root{color-scheme:light;font-family:ui-sans-serif,system-ui,sans-serif;background:#f7f7f5;color:#18181b}
    *{box-sizing:border-box}body{margin:0}main{min-height:100dvh;display:grid;place-items:center;padding:24px}
    section{width:min(100%,32rem);border-left:2px solid #dc2626;padding-left:20px}h1{margin:0;font-size:1.5rem;line-height:1.3}
    p{margin:16px 0 0;color:#52525b;font-size:.875rem;line-height:1.6}a{display:inline-flex;min-height:44px;align-items:center;margin-top:24px;padding:0 16px;border:1px solid #d4d4d8;border-radius:6px;color:inherit;text-decoration:none;background:#fff}
    a:focus-visible{outline:2px solid #2563eb;outline-offset:2px}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
  </style>
</head>
<body><main><section aria-labelledby="page-error-title"><h1 id="page-error-title">${escapeHtml(copy.title)}</h1><p role="alert">${escapeHtml(copy.description)}</p><a href="/">${escapeHtml(t("common.backHome"))}</a></section></main></body>
</html>`;

  return new NextResponse(body, {
    status,
    statusText: errorResponse.statusText,
    headers,
  });
};

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
      const errorResponse = toErrorResponse(error);
      response = localizeBoardPageErrorResponse(request, errorResponse);
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

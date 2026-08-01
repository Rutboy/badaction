import type { NextRequest } from "next/server.js";
import { NextResponse } from "next/server.js";
import { toErrorResponse } from "@/lib/errors/api-error";
import {
  createBoardPageMiddleware,
  localizeBoardPageErrorResponse,
} from "@/lib/http/board-page-middleware";
import { assertBoardPreAuthRateLimit } from "@/lib/ratelimit/board-pre-auth-rate-limit";

const handleBoardPageRequest = createBoardPageMiddleware();

export async function middleware(request: NextRequest) {
  try {
    await assertBoardPreAuthRateLimit({ headers: request.headers });
  } catch (error) {
    const response = toErrorResponse(error);
    return request.nextUrl.pathname.startsWith("/boards/")
      ? localizeBoardPageErrorResponse(request, response)
      : response;
  }

  if (request.nextUrl.pathname.startsWith("/api/boards")) {
    return NextResponse.next();
  }

  return handleBoardPageRequest(request);
}

export const config = {
  matcher: [
    "/boards/:boardId",
    "/api/boards/:path*",
    "/api/invitations/:path*",
  ],
  runtime: "nodejs",
};

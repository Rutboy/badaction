import {
  deleteBoardAsOwner,
  requireActiveBoardOwner,
} from "@/lib/access/acl-service";
import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { getVisitorRateLimitIdentity } from "@/lib/http/client-ip";
import {
  NO_STORE_HEADERS,
  handleContentRoute,
  noStoreJson,
  parseContentQuery,
  parseContentUuid,
  prepareBoardJsonContentMutation,
  prepareContentRead,
} from "@/lib/http/content-route";
import {
  assertNoRequestBody,
  assertSameOriginMutation,
} from "@/lib/http/request-security";
import { assertRateLimit } from "@/lib/ratelimit/memory-rate-limit";
import {
  getTargetBoardSnapshot,
  updateBoardSettings,
} from "@/lib/services/target-content-service";
import {
  patchTargetBoardSchema,
  targetBoardPageQuerySchema,
} from "@/lib/validators/target-content";

type BoardRouteContext = { params: Promise<{ boardId: string }> };

export async function GET(request: Request, { params }: BoardRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const query = parseContentQuery(request, targetBoardPageQuerySchema);
    const { visitorPayload, visitorIdentity } = await prepareContentRead({
      request,
      boardId,
    });
    const board = await getTargetBoardSnapshot(
      boardId,
      visitorPayload,
      visitorIdentity,
      query.limit,
    );
    return noStoreJson(board);
  });
}

export async function PATCH(request: Request, { params }: BoardRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "board.update",
      schema: patchTargetBoardSchema,
      boardId,
    });
    const result = await updateBoardSettings(boardId, visitorPayload, payload);
    return noStoreJson(result);
  });
}

export async function DELETE(request: Request, { params }: BoardRouteContext) {
  return handleContentRoute(async () => {
    assertSameOriginMutation(request);
    await assertNoRequestBody(request);
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardOwner(boardId, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${boardId}`);
    await assertRateLimit(`delete-board:${boardId}:visitor:${identity}`, 5, 60 * 1000);
    await deleteBoardAsOwner(boardId, visitorPayload);
    return new Response(null, { status: 204, headers: NO_STORE_HEADERS });
  });
}

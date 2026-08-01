import {
  leaveBoard,
  requireActiveBoardMember,
  updateCurrentMembershipDisplayName,
} from "@/lib/access/acl-service";
import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError, toErrorResponse } from "@/lib/errors/api-error";
import { getVisitorRateLimitIdentity } from "@/lib/http/client-ip";
import {
  assertNoRequestBody,
  assertSameOriginMutation,
  readJsonBody,
} from "@/lib/http/request-security";
import { assertRateLimit } from "@/lib/ratelimit/memory-rate-limit";
import { patchMembershipSchema } from "@/lib/validators/access";
import { uuidParamSchema } from "@/lib/validators/common";

const parseBoardId = async (params: Promise<{ boardId: string }>) => {
  const parsed = uuidParamSchema.safeParse((await params).boardId);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Invalid boardId.");
  }
  return parsed.data;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    const boardId = await parseBoardId(params);
    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardMember(boardId, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${boardId}`);
    await assertRateLimit(`rename-membership:${boardId}:visitor:${identity}`, 20, 60 * 1000);

    const parsed = patchMembershipSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Name validation failed.", {
        issues: parsed.error.issues,
      });
    }
    const result = await updateCurrentMembershipDisplayName(
      boardId,
      visitorPayload,
      parsed.data.displayName,
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    await assertNoRequestBody(request);
    const boardId = await parseBoardId(params);

    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardMember(boardId, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${boardId}`);
    await assertRateLimit(`leave-board:${boardId}:visitor:${identity}`, 5, 60 * 1000);
    await leaveBoard(boardId, visitorPayload);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

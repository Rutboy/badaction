import { requireActiveBoardOwner, revokeBoardInvitation } from "@/lib/access/acl-service";
import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError, toErrorResponse } from "@/lib/errors/api-error";
import { getVisitorRateLimitIdentity } from "@/lib/http/client-ip";
import { assertNoRequestBody, assertSameOriginMutation } from "@/lib/http/request-security";
import { assertRateLimit } from "@/lib/ratelimit/memory-rate-limit";
import { uuidParamSchema } from "@/lib/validators/common";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ boardId: string; invitationId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    await assertNoRequestBody(request);
    const { boardId, invitationId } = await params;
    const parsedBoardId = uuidParamSchema.safeParse(boardId);
    const parsedInvitationId = uuidParamSchema.safeParse(invitationId);
    if (!parsedBoardId.success || !parsedInvitationId.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid UUID.");
    }

    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardOwner(parsedBoardId.data, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${parsedBoardId.data}`);
    await assertRateLimit(
      `revoke-invitation:${parsedBoardId.data}:visitor:${identity}`,
      30,
      60 * 1000,
    );
    await revokeBoardInvitation(
      parsedBoardId.data,
      parsedInvitationId.data,
      visitorPayload,
    );
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

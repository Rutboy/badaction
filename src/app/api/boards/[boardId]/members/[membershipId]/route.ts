import { requireActiveBoardOwner, revokeBoardParticipant } from "@/lib/access/acl-service";
import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError, toErrorResponse } from "@/lib/errors/api-error";
import { getVisitorRateLimitIdentity } from "@/lib/http/client-ip";
import { assertNoRequestBody, assertSameOriginMutation } from "@/lib/http/request-security";
import { assertRateLimit } from "@/lib/ratelimit/memory-rate-limit";
import { uuidParamSchema } from "@/lib/validators/common";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ boardId: string; membershipId: string }> },
) {
  try {
    assertSameOriginMutation(request);
    await assertNoRequestBody(request);
    const { boardId, membershipId } = await params;
    const parsedBoardId = uuidParamSchema.safeParse(boardId);
    const parsedMembershipId = uuidParamSchema.safeParse(membershipId);
    if (!parsedBoardId.success || !parsedMembershipId.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid UUID.");
    }

    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardOwner(parsedBoardId.data, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${parsedBoardId.data}`);
    await assertRateLimit(
      `revoke-member:${parsedBoardId.data}:visitor:${identity}`,
      30,
      60 * 1000,
    );
    await revokeBoardParticipant(
      parsedBoardId.data,
      parsedMembershipId.data,
      visitorPayload,
    );
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

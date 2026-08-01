import { listBoardParticipants, requireActiveBoardOwner } from "@/lib/access/acl-service";
import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError, toErrorResponse } from "@/lib/errors/api-error";
import { getVisitorRateLimitIdentity } from "@/lib/http/client-ip";
import { assertRateLimit } from "@/lib/ratelimit/memory-rate-limit";
import { uuidParamSchema } from "@/lib/validators/common";

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const parsed = uuidParamSchema.safeParse((await params).boardId);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid boardId.");
    }

    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardOwner(parsed.data, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${parsed.data}`);
    await assertRateLimit(`list-members:${parsed.data}:visitor:${identity}`, 60, 60 * 1000);
    const result = await listBoardParticipants(parsed.data, visitorPayload);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

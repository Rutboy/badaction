import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { requireActiveBoardMember } from "@/lib/access/acl-service";
import { ApiError, toErrorResponse } from "@/lib/errors/api-error";
import {
  getTrustedProxyRateLimitIdentity,
  getVisitorRateLimitIdentity,
} from "@/lib/http/client-ip";
import { assertNoRequestBody, assertSameOriginMutation } from "@/lib/http/request-security";
import { assertRateLimit } from "@/lib/ratelimit/memory-rate-limit";
import {
  deriveContentVisitorIdentity,
  likeCardLegacyAdapter,
} from "@/lib/services/target-content-service";
import { uuidParamSchema } from "@/lib/validators/common";

const withDeprecation = (response: Response): Response => {
  response.headers.set("Deprecation", "true");
  return response;
};

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string; cardId: string }> }) {
  try {
    assertSameOriginMutation(request);
    await assertNoRequestBody(request);
    const visitorPayload = await getOrSetVisitorToken();

    const { boardId, cardId } = await params;
    const boardResult = uuidParamSchema.safeParse(boardId);
    const cardResult = uuidParamSchema.safeParse(cardId);

    if (!boardResult.success || !cardResult.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invalid UUID.");
    }

    await requireActiveBoardMember(boardResult.data, visitorPayload);
    const scope = `board:${boardResult.data}`;
    const visitorIdentity = getVisitorRateLimitIdentity(visitorPayload, scope);
    const ipIdentity = getTrustedProxyRateLimitIdentity(request.headers, scope);
    await assertRateLimit(`like:${boardResult.data}:visitor:${visitorIdentity}`, 20, 60 * 1000);
    if (ipIdentity) {
      await assertRateLimit(`like:${boardResult.data}:ip:${ipIdentity}`, 200, 60 * 1000);
    }

    const contentVisitorIdentity = deriveContentVisitorIdentity(
      boardResult.data,
      visitorPayload,
    );
    const result = await likeCardLegacyAdapter(
      boardResult.data,
      cardResult.data,
      visitorPayload,
      contentVisitorIdentity,
    );

    return withDeprecation(Response.json(result, {
      headers: {
        "Cache-Control": "no-store",
        "Deprecation": "true",
      },
    }));
  } catch (error) {
    return withDeprecation(toErrorResponse(error));
  }
}

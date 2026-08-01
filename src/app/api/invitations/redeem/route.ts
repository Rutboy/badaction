import { redeemBoardInvitation } from "@/lib/access/acl-service";
import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError, toErrorResponse } from "@/lib/errors/api-error";
import {
  getTrustedProxyRateLimitIdentity,
  getVisitorRateLimitIdentity,
} from "@/lib/http/client-ip";
import { assertSameOriginMutation, readJsonBody } from "@/lib/http/request-security";
import { assertRateLimit } from "@/lib/ratelimit/memory-rate-limit";
import { redeemInvitationSchema } from "@/lib/validators/access";

export async function POST(request: Request) {
  try {
    assertSameOriginMutation(request);
    const visitorPayload = await getOrSetVisitorToken();
    const visitorIdentity = getVisitorRateLimitIdentity(visitorPayload, "invitation-redeem");
    const ipIdentity = getTrustedProxyRateLimitIdentity(request.headers, "invitation-redeem");
    if (ipIdentity) {
      await assertRateLimit(`invitation-redeem:ip:${ipIdentity}`, 200, 10 * 60 * 1000);
    }
    await assertRateLimit(`invitation-redeem:visitor:${visitorIdentity}`, 20, 10 * 60 * 1000);

    const parsed = redeemInvitationSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Invitation validation failed.", {
        issues: parsed.error.issues,
      });
    }

    const membership = await redeemBoardInvitation(
      parsed.data.token,
      visitorPayload,
      parsed.data.displayName ?? "Participant",
    );
    return Response.json(membership, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

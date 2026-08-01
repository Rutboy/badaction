import {
  createParticipantInvitation,
  listBoardInvitations,
  requireActiveBoardOwner,
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
import { createInvitationSchema } from "@/lib/validators/access";
import { uuidParamSchema } from "@/lib/validators/common";

const parseBoardId = async (params: Promise<{ boardId: string }>) => {
  const parsed = uuidParamSchema.safeParse((await params).boardId);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Некорректный boardId");
  }
  return parsed.data;
};

export async function GET(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    const boardId = await parseBoardId(params);
    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardOwner(boardId, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${boardId}`);
    await assertRateLimit(`list-invitations:${boardId}:visitor:${identity}`, 60, 60 * 1000);
    const invitations = await listBoardInvitations(boardId, visitorPayload);
    return Response.json({ invitations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ boardId: string }> }) {
  try {
    assertSameOriginMutation(request);
    let body: unknown = {};
    if (request.body === null) {
      await assertNoRequestBody(request);
    } else {
      body = await readJsonBody(request);
    }
    const parsed = createInvitationSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, "VALIDATION_ERROR", "Ошибка валидации приглашения", {
        issues: parsed.error.issues,
      });
    }
    const boardId = await parseBoardId(params);
    const visitorPayload = await getOrSetVisitorToken();
    await requireActiveBoardOwner(boardId, visitorPayload);
    const identity = getVisitorRateLimitIdentity(visitorPayload, `board:${boardId}`);
    await assertRateLimit(`create-invitation:${boardId}:visitor:${identity}`, 10, 60 * 1000);
    const invitation = await createParticipantInvitation(boardId, visitorPayload, parsed.data);
    return Response.json(
      {
        id: invitation.id,
        expiresAt: invitation.expiresAt.toISOString(),
        maxUses: invitation.maxUses,
        joinPath: `/join#${invitation.token}`,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

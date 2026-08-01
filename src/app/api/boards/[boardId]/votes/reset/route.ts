import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { resetBoardVotes } from "@/lib/services/target-content-service";
import { resetTargetVotesSchema } from "@/lib/validators/target-content";

type VoteResetRouteContext = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, { params }: VoteResetRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "votes.reset",
      schema: resetTargetVotesSchema,
      boardId,
    });
    const result = await resetBoardVotes(
      boardId,
      visitorPayload,
      payload.expectedRevision,
    );
    return noStoreJson(result);
  });
}

import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { moveCardGroup } from "@/lib/services/target-content-service";
import { moveTargetGroupSchema } from "@/lib/validators/target-content";

type GroupMoveRouteContext = {
  params: Promise<{ boardId: string; groupId: string }>;
};

export async function POST(request: Request, { params }: GroupMoveRouteContext) {
  return handleContentRoute(async () => {
    const values = await params;
    const boardId = parseContentUuid(values.boardId, "boardId");
    const groupId = parseContentUuid(values.groupId, "groupId");
    const { visitorPayload, visitorIdentity, payload } =
      await prepareBoardJsonContentMutation({
        request,
        mutation: "group.move",
        schema: moveTargetGroupSchema,
        boardId,
      });
    const result = await moveCardGroup(
      boardId,
      groupId,
      visitorPayload,
      visitorIdentity,
      payload,
    );
    return noStoreJson(result);
  });
}

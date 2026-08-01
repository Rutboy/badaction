import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { updateCardGroup } from "@/lib/services/target-content-service";
import { patchTargetGroupSchema } from "@/lib/validators/target-content";

type GroupRouteContext = {
  params: Promise<{ boardId: string; groupId: string }>;
};

export async function PATCH(request: Request, { params }: GroupRouteContext) {
  return handleContentRoute(async () => {
    const values = await params;
    const boardId = parseContentUuid(values.boardId, "boardId");
    const groupId = parseContentUuid(values.groupId, "groupId");
    const { visitorPayload, visitorIdentity, payload } =
      await prepareBoardJsonContentMutation({
        request,
        mutation: "group.update",
        schema: patchTargetGroupSchema,
        boardId,
      });
    const result = await updateCardGroup(
      boardId,
      groupId,
      visitorPayload,
      visitorIdentity,
      payload,
    );
    return noStoreJson(result);
  });
}

import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { ungroupCardGroup } from "@/lib/services/target-content-service";
import { ungroupTargetGroupSchema } from "@/lib/validators/target-content";

type GroupUngroupRouteContext = {
  params: Promise<{ boardId: string; groupId: string }>;
};

export async function POST(request: Request, { params }: GroupUngroupRouteContext) {
  return handleContentRoute(async () => {
    const values = await params;
    const boardId = parseContentUuid(values.boardId, "boardId");
    const groupId = parseContentUuid(values.groupId, "groupId");
    const { visitorPayload, visitorIdentity, payload } =
      await prepareBoardJsonContentMutation({
        request,
        mutation: "group.ungroup",
        schema: ungroupTargetGroupSchema,
        boardId,
      });
    const result = await ungroupCardGroup(
      boardId,
      groupId,
      visitorPayload,
      visitorIdentity,
      payload.expectedRevision,
    );
    return noStoreJson(result);
  });
}

import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { createCardGroup } from "@/lib/services/target-content-service";
import { createTargetGroupSchema } from "@/lib/validators/target-content";

type GroupsRouteContext = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, { params }: GroupsRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const { visitorPayload, visitorIdentity, payload } =
      await prepareBoardJsonContentMutation({
        request,
        mutation: "group.create",
        schema: createTargetGroupSchema,
        boardId,
      });
    const result = await createCardGroup(
      boardId,
      visitorPayload,
      visitorIdentity,
      payload,
    );
    return noStoreJson(result, { status: 201 });
  });
}

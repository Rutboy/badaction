import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { createActionItem } from "@/lib/services/target-content-service";
import { createTargetActionItemSchema } from "@/lib/validators/target-content";

type ActionItemsRouteContext = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, { params }: ActionItemsRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "action.create",
      schema: createTargetActionItemSchema,
      boardId,
    });
    const result = await createActionItem(boardId, visitorPayload, payload);
    return noStoreJson(result, { status: 201 });
  });
}

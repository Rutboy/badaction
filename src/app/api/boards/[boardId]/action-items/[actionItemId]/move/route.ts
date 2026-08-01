import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { moveActionItem } from "@/lib/services/target-content-service";
import { moveTargetActionItemSchema } from "@/lib/validators/target-content";

type ActionItemMoveRouteContext = {
  params: Promise<{ boardId: string; actionItemId: string }>;
};

export async function POST(
  request: Request,
  { params }: ActionItemMoveRouteContext,
) {
  return handleContentRoute(async () => {
    const values = await params;
    const boardId = parseContentUuid(values.boardId, "boardId");
    const actionItemId = parseContentUuid(values.actionItemId, "actionItemId");
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "action.move",
      schema: moveTargetActionItemSchema,
      boardId,
    });
    const result = await moveActionItem(
      boardId,
      actionItemId,
      visitorPayload,
      payload,
    );
    return noStoreJson(result);
  });
}

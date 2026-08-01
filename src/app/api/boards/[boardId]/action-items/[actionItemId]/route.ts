import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import {
  deleteActionItem,
  updateActionItem,
} from "@/lib/services/target-content-service";
import {
  deleteTargetActionItemSchema,
  patchTargetActionItemSchema,
} from "@/lib/validators/target-content";

type ActionItemRouteContext = {
  params: Promise<{ boardId: string; actionItemId: string }>;
};

const parseParams = async ({ params }: ActionItemRouteContext) => {
  const values = await params;
  return {
    boardId: parseContentUuid(values.boardId, "boardId"),
    actionItemId: parseContentUuid(values.actionItemId, "actionItemId"),
  };
};

export async function PATCH(request: Request, context: ActionItemRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, actionItemId } = await parseParams(context);
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "action.update",
      schema: patchTargetActionItemSchema,
      boardId,
    });
    const result = await updateActionItem(
      boardId,
      actionItemId,
      visitorPayload,
      payload,
    );
    return noStoreJson(result);
  });
}

export async function DELETE(request: Request, context: ActionItemRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, actionItemId } = await parseParams(context);
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "action.delete",
      schema: deleteTargetActionItemSchema,
      boardId,
    });
    const result = await deleteActionItem(
      boardId,
      actionItemId,
      visitorPayload,
      payload.expectedRevision,
    );
    return noStoreJson(result);
  });
}

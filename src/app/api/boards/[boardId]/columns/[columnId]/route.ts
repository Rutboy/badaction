import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import {
  deleteBoardColumn,
  updateBoardColumn,
} from "@/lib/services/target-content-service";
import {
  deleteTargetColumnSchema,
  patchTargetColumnSchema,
} from "@/lib/validators/target-content";

type ColumnRouteContext = {
  params: Promise<{ boardId: string; columnId: string }>;
};

const parseParams = async ({ params }: ColumnRouteContext) => {
  const values = await params;
  return {
    boardId: parseContentUuid(values.boardId, "boardId"),
    columnId: parseContentUuid(values.columnId, "columnId"),
  };
};

export async function PATCH(request: Request, context: ColumnRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, columnId } = await parseParams(context);
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "column.update",
      schema: patchTargetColumnSchema,
      boardId,
    });
    const result = await updateBoardColumn(
      boardId,
      columnId,
      visitorPayload,
      payload,
    );
    return noStoreJson(result);
  });
}

export async function DELETE(request: Request, context: ColumnRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, columnId } = await parseParams(context);
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "column.delete",
      schema: deleteTargetColumnSchema,
      boardId,
    });
    const result = await deleteBoardColumn(
      boardId,
      columnId,
      visitorPayload,
      payload,
    );
    return noStoreJson(result);
  });
}

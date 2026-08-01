import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { moveBoardColumn } from "@/lib/services/target-content-service";
import { moveTargetColumnSchema } from "@/lib/validators/target-content";

type ColumnMoveRouteContext = {
  params: Promise<{ boardId: string; columnId: string }>;
};

export async function POST(request: Request, { params }: ColumnMoveRouteContext) {
  return handleContentRoute(async () => {
    const values = await params;
    const boardId = parseContentUuid(values.boardId, "boardId");
    const columnId = parseContentUuid(values.columnId, "columnId");
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "column.move",
      schema: moveTargetColumnSchema,
      boardId,
    });
    const result = await moveBoardColumn(
      boardId,
      columnId,
      visitorPayload,
      payload,
    );
    return noStoreJson(result);
  });
}

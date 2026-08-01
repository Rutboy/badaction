import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { createBoardColumn } from "@/lib/services/target-content-service";
import { createTargetColumnSchema } from "@/lib/validators/target-content";

type ColumnsRouteContext = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, { params }: ColumnsRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "column.create",
      schema: createTargetColumnSchema,
      boardId,
    });
    const result = await createBoardColumn(boardId, visitorPayload, payload);
    return noStoreJson(result, { status: 201 });
  });
}

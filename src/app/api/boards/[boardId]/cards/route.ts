import {
  handleContentRoute,
  noStoreJson,
  parseContentQuery,
  parseContentUuid,
  prepareBoardJsonContentMutation,
  prepareContentRead,
} from "@/lib/http/content-route";
import {
  createTargetCard,
  getTargetCardPage,
} from "@/lib/services/target-content-service";
import {
  createTargetCardSchema,
  targetCardPageQuerySchema,
} from "@/lib/validators/target-content";

type CardsRouteContext = { params: Promise<{ boardId: string }> };

export async function GET(request: Request, { params }: CardsRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const query = parseContentQuery(request, targetCardPageQuerySchema);
    const { visitorPayload, visitorIdentity } = await prepareContentRead({
      request,
      boardId,
    });
    const page = await getTargetCardPage(
      boardId,
      visitorPayload,
      visitorIdentity,
      query.columnId,
      query.cursor,
      query.limit,
    );
    return noStoreJson(page);
  });
}

export async function POST(request: Request, { params }: CardsRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "card.create",
      schema: createTargetCardSchema,
      boardId,
    });
    const result = await createTargetCard(boardId, visitorPayload, payload);
    return noStoreJson(result, { status: 201 });
  });
}

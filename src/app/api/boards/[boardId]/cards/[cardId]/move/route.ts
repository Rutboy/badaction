import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import { moveTargetCard } from "@/lib/services/target-content-service";
import { moveTargetCardSchema } from "@/lib/validators/target-content";

type CardMoveRouteContext = {
  params: Promise<{ boardId: string; cardId: string }>;
};

export async function POST(request: Request, { params }: CardMoveRouteContext) {
  return handleContentRoute(async () => {
    const values = await params;
    const boardId = parseContentUuid(values.boardId, "boardId");
    const cardId = parseContentUuid(values.cardId, "cardId");
    const { visitorPayload, visitorIdentity, payload } =
      await prepareBoardJsonContentMutation({
        request,
        mutation: "card.move",
        schema: moveTargetCardSchema,
        boardId,
      });
    const result = await moveTargetCard(
      boardId,
      cardId,
      visitorPayload,
      visitorIdentity,
      payload,
    );
    return noStoreJson(result);
  });
}

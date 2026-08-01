import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBoardJsonContentMutation,
} from "@/lib/http/content-route";
import {
  deleteTargetCard,
  updateTargetCard,
} from "@/lib/services/target-content-service";
import {
  deleteTargetCardSchema,
  patchTargetCardSchema,
} from "@/lib/validators/target-content";

type CardRouteContext = {
  params: Promise<{ boardId: string; cardId: string }>;
};

const parseParams = async ({ params }: CardRouteContext) => {
  const values = await params;
  return {
    boardId: parseContentUuid(values.boardId, "boardId"),
    cardId: parseContentUuid(values.cardId, "cardId"),
  };
};

export async function PATCH(request: Request, context: CardRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, cardId } = await parseParams(context);
    const { visitorPayload, visitorIdentity, payload } =
      await prepareBoardJsonContentMutation({
        request,
        mutation: "card.update",
        schema: patchTargetCardSchema,
        boardId,
      });
    const result = await updateTargetCard(
      boardId,
      cardId,
      visitorPayload,
      visitorIdentity,
      payload,
    );
    return noStoreJson(result);
  });
}

export async function DELETE(request: Request, context: CardRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, cardId } = await parseParams(context);
    const { visitorPayload, payload } = await prepareBoardJsonContentMutation({
      request,
      mutation: "card.delete",
      schema: deleteTargetCardSchema,
      boardId,
    });
    const result = await deleteTargetCard(
      boardId,
      cardId,
      visitorPayload,
      payload.expectedRevision,
    );
    return noStoreJson(result);
  });
}

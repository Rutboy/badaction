import {
  handleContentRoute,
  noStoreJson,
  parseContentUuid,
  prepareBodylessContentMutation,
} from "@/lib/http/content-route";
import {
  removeVoteFromCard,
  voteForCard,
} from "@/lib/services/target-content-service";

type CardVoteRouteContext = {
  params: Promise<{ boardId: string; cardId: string }>;
};

const parseParams = async ({ params }: CardVoteRouteContext) => {
  const values = await params;
  return {
    boardId: parseContentUuid(values.boardId, "boardId"),
    cardId: parseContentUuid(values.cardId, "cardId"),
  };
};

export async function PUT(request: Request, context: CardVoteRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, cardId } = await parseParams(context);
    const { visitorPayload, visitorIdentity } =
      await prepareBodylessContentMutation({
        request,
        mutation: "vote.create",
        boardId,
      });
    const result = await voteForCard(
      boardId,
      cardId,
      visitorPayload,
      visitorIdentity,
    );
    return noStoreJson(result);
  });
}

export async function DELETE(request: Request, context: CardVoteRouteContext) {
  return handleContentRoute(async () => {
    const { boardId, cardId } = await parseParams(context);
    const { visitorPayload, visitorIdentity } =
      await prepareBodylessContentMutation({
        request,
        mutation: "vote.delete",
        boardId,
      });
    const result = await removeVoteFromCard(
      boardId,
      cardId,
      visitorPayload,
      visitorIdentity,
    );
    return noStoreJson(result);
  });
}

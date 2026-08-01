import {
  handleContentRoute,
  noStoreJson,
  prepareJsonContentMutation,
} from "@/lib/http/content-route";
import { createTargetBoard } from "@/lib/services/target-content-service";
import { createTargetBoardSchema } from "@/lib/validators/target-content";

export async function POST(request: Request) {
  return handleContentRoute(async () => {
    const { visitorPayload, payload } = await prepareJsonContentMutation({
      request,
      mutation: "board.create",
      schema: createTargetBoardSchema,
    });
    const board = await createTargetBoard(visitorPayload, payload.title);

    return noStoreJson(
      {
        id: board.id,
        url: `/boards/${board.id}`,
        title: board.title,
        revision: board.revision,
        createdAt: board.createdAt.toISOString(),
        expiresAt: board.expiresAt.toISOString(),
      },
      { status: 201 },
    );
  });
}

import {
  handleContentRoute,
  parseContentUuid,
  prepareContentExport,
} from "@/lib/http/content-route";
import { serializeTargetMarkdownExport } from "@/lib/export/target-export";
import { getTargetBoardExport } from "@/lib/services/target-content-service";

type ExportRouteContext = { params: Promise<{ boardId: string }> };

export async function GET(request: Request, { params }: ExportRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const { visitorPayload } = await prepareContentExport({ request, boardId });
    const data = await getTargetBoardExport(boardId, visitorPayload);
    return new Response(serializeTargetMarkdownExport(data), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="retro-${boardId}.md"`,
      },
    });
  });
}

import { getOrSetVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError } from "@/lib/errors/api-error";
import { DATABASE_UNAVAILABLE_CODE } from "@/lib/errors/prisma";
import {
  handleContentRoute,
  parseContentUuid,
} from "@/lib/http/content-route";
import { assertBoardEventsRateLimits } from "@/lib/ratelimit/board-events-rate-limit";
import {
  boardStreamLimit,
  type BoardStreamLease,
} from "@/lib/realtime/board-stream-limit";
import type { BoardMutationEvent } from "@/lib/realtime/board-events";
import { getPostgresBoardListener } from "@/lib/realtime/postgres-board-listener";
import {
  compareRevisions,
  formatBoardInvalidationEvent,
  formatBoardReadyEvent,
  formatHeartbeat,
  formatMutationInvalidationEvent,
  parseLastEventId,
} from "@/lib/realtime/sse-wire";
import { getBoardEventAccessState } from "@/lib/services/board-events-service";
import { deriveContentVisitorIdentity } from "@/lib/services/target-content-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEARTBEAT_INTERVAL_MS = 12_000;
const ACCESS_REVALIDATION_INTERVAL_MS = 30_000;
const MAX_STREAM_BUFFER_BYTES = 64 * 1024;
const encoder = new TextEncoder();

type BoardEventsRouteContext = { params: Promise<{ boardId: string }> };

const validationError = () => new ApiError(
  400,
  "VALIDATION_ERROR",
  "Некорректный Last-Event-ID.",
);

const realtimeUnavailable = () => new ApiError(
  503,
  DATABASE_UNAVAILABLE_CODE,
  "База данных временно недоступна.",
);

const readLastEventId = (request: Request): bigint | null => {
  try {
    return parseLastEventId(request.headers.get("last-event-id"));
  } catch {
    throw validationError();
  }
};

export async function GET(request: Request, { params }: BoardEventsRouteContext) {
  return handleContentRoute(async () => {
    const boardId = parseContentUuid((await params).boardId, "boardId");
    const visitorPayload = await getOrSetVisitorToken();

    // ACL is checked before both shared and local stream accounting. A second
    // check after LISTEN is active closes the race between the snapshot revision
    // and listener subscription.
    await getBoardEventAccessState(boardId, visitorPayload);
    await assertBoardEventsRateLimits({
      boardId,
      headers: request.headers,
      visitorPayload,
    });
    const lastEventId = readLastEventId(request);
    const visitorIdentity = deriveContentVisitorIdentity(boardId, visitorPayload);
    const lease: BoardStreamLease = boardStreamLimit.acquire(boardId, visitorIdentity);
    const listener = getPostgresBoardListener();
    let unsubscribe: () => void = () => undefined;
    let handedOffToStream = false;
    let pendingEvent: BoardMutationEvent | null = null;
    let listenerUnavailableBeforeOpen = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    let lastSentRevision = "0";
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let accessTimer: ReturnType<typeof setInterval> | null = null;
    let accessCheckInFlight = false;
    let closed = false;

    const removeAbortListener = () => {
      request.signal.removeEventListener("abort", closeStream);
    };
    const releaseResources = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (accessTimer) {
        clearInterval(accessTimer);
        accessTimer = null;
      }
      removeAbortListener();
      unsubscribe();
      lease.release();
    };
    const closeStream = () => {
      if (closed) {
        return;
      }
      closed = true;
      pendingEvent = null;
      releaseResources();
      try {
        controller?.close();
      } catch {
        // The consumer may already have canceled the stream.
      }
    };
    request.signal.addEventListener("abort", closeStream, { once: true });
    if (request.signal.aborted) {
      closeStream();
    }

    try {
      if (closed) {
        throw new Error("Realtime request was aborted before listener setup");
      }
      try {
        await listener.ensureListening();
      } catch {
        throw realtimeUnavailable();
      }
      if (closed) {
        throw new Error("Realtime request was aborted during listener setup");
      }
      const enqueue = (value: string) => {
        if (closed || !controller) {
          return;
        }
        try {
          const chunk = encoder.encode(value);
          if (
            controller.desiredSize !== null
            && controller.desiredSize < chunk.byteLength
          ) {
            closeStream();
            return;
          }
          controller.enqueue(chunk);
        } catch {
          closeStream();
        }
      };
      const sendMutationEvent = (event: BoardMutationEvent) => {
        if (closed || compareRevisions(event.revision, lastSentRevision) <= 0) {
          return;
        }
        lastSentRevision = event.revision;
        enqueue(formatMutationInvalidationEvent(event));
      };

      unsubscribe = listener.subscribe(boardId, {
        onEvent: (event) => {
          if (controller) {
            sendMutationEvent(event);
          } else if (
            !pendingEvent
            || compareRevisions(event.revision, pendingEvent.revision) > 0
          ) {
            // SSE is invalidation-only, so the newest revision subsumes every
            // earlier notification while the second ACL snapshot is pending.
            pendingEvent = event;
          }
        },
        onUnavailable: () => {
          listenerUnavailableBeforeOpen = true;
          closeStream();
        },
      });

      const state = await getBoardEventAccessState(boardId, visitorPayload);
      if (listenerUnavailableBeforeOpen) {
        throw realtimeUnavailable();
      }
      if (closed) {
        throw new Error("Realtime request was aborted during access validation");
      }
      const currentRevision = BigInt(state.revision);
      if (lastEventId !== null && lastEventId > currentRevision) {
        throw validationError();
      }
      lastSentRevision = state.revision;

      const stream = new ReadableStream<Uint8Array>({
        start(streamController) {
          controller = streamController;

          if (lastEventId !== null && lastEventId < currentRevision) {
            enqueue(formatBoardInvalidationEvent({
              boardId,
              revision: state.revision,
              type: "resync",
            }));
          } else {
            enqueue(formatBoardReadyEvent(boardId, state.revision));
          }

          if (pendingEvent) {
            sendMutationEvent(pendingEvent);
          }
          pendingEvent = null;
          if (closed) {
            return;
          }

          heartbeatTimer = setInterval(() => {
            enqueue(formatHeartbeat());
          }, HEARTBEAT_INTERVAL_MS);
          accessTimer = setInterval(() => {
            if (accessCheckInFlight || closed) {
              return;
            }
            accessCheckInFlight = true;
            void getBoardEventAccessState(boardId, visitorPayload)
              .catch(() => closeStream())
              .finally(() => {
                accessCheckInFlight = false;
              });
          }, ACCESS_REVALIDATION_INTERVAL_MS);
        },
        cancel() {
          closeStream();
        },
      }, {
        highWaterMark: MAX_STREAM_BUFFER_BYTES,
        size: (chunk) => chunk.byteLength,
      });

      handedOffToStream = true;
      return new Response(stream, {
        headers: {
          "Cache-Control": "no-store, no-transform",
          Connection: "keep-alive",
          "Content-Type": "text/event-stream; charset=utf-8",
          "X-Accel-Buffering": "no",
        },
      });
    } finally {
      if (!handedOffToStream) {
        closeStream();
      }
    }
  });
}

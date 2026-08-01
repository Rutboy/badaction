"use client";

import { useEffect, useRef, useState } from "react";
import {
  getReconnectDelayMs,
  parseBoardSseEvent,
  SseEventParser,
  SseProtocolError,
} from "@/lib/realtime/sse-client";

const RECONCILIATION_INTERVAL_MS = 30_000;
const MAX_SYNC_ATTEMPTS = 3;

export type BoardConnectionStatus =
  | "connecting"
  | "online"
  | "reconnecting"
  | "polling";

export type BoardRefreshResult =
  | { status: "ok"; revision: string }
  | { status: "access-lost" }
  | { status: "retryable" };

export type BoardRefreshOptions = {
  force?: boolean;
};

const compareRevisions = (left: string, right: string): number => {
  const leftRevision = BigInt(left);
  const rightRevision = BigInt(right);
  return leftRevision < rightRevision ? -1 : leftRevision > rightRevision ? 1 : 0;
};

export const useBoardRealtime = ({
  boardId,
  appliedRevision,
  enabled,
  refreshBoard,
  onAccessLost,
}: {
  boardId: string;
  appliedRevision: string;
  enabled: boolean;
  refreshBoard: () => Promise<BoardRefreshResult>;
  onAccessLost: () => void;
}): BoardConnectionStatus => {
  const [status, setStatus] = useState<BoardConnectionStatus>("connecting");
  const appliedRevisionRef = useRef(appliedRevision);

  useEffect(() => {
    appliedRevisionRef.current = appliedRevision;
  }, [appliedRevision]);

  useEffect(() => {
    if (!enabled) {
      setStatus("polling");
      return;
    }

    let stopped = false;
    let accessLost = false;
    let pollingOnly = false;
    let streamOnline = false;
    let connectedOnce = false;
    let reconnectAttempt = 0;
    let activeRequest: AbortController | null = null;
    let reconnectWait: {
      timer: ReturnType<typeof setTimeout>;
      resolve: () => void;
    } | null = null;
    let requestedRevision = appliedRevisionRef.current;
    let refreshInFlight: Promise<void> | null = null;

    const updateRequestedRevision = (revision: string) => {
      if (compareRevisions(revision, requestedRevision) > 0) {
        requestedRevision = revision;
      }
    };

    const markAccessLost = () => {
      if (accessLost || stopped) {
        return;
      }
      accessLost = true;
      activeRequest?.abort();
      onAccessLost();
    };

    const refreshAuthoritativeState = (
      targetRevision?: string,
      force = false,
    ): Promise<void> => {
      if (targetRevision) {
        updateRequestedRevision(targetRevision);
      }
      if (refreshInFlight) {
        return refreshInFlight;
      }

      let observedRequestedRevision = requestedRevision;
      const operation = (async () => {
        let forceNextRefresh = force;
        for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt += 1) {
          if (stopped || accessLost) {
            return;
          }
          const desiredRevision = requestedRevision;
          observedRequestedRevision = desiredRevision;
          if (
            !forceNextRefresh
            && compareRevisions(appliedRevisionRef.current, desiredRevision) >= 0
          ) {
            return;
          }

          const previousRevision = appliedRevisionRef.current;
          const result = await refreshBoard();
          if (stopped) {
            return;
          }
          if (result.status === "access-lost") {
            markAccessLost();
            return;
          }
          if (result.status === "retryable") {
            setStatus("polling");
            return;
          }

          const reachedRequestedRevision = compareRevisions(
            result.revision,
            requestedRevision,
          ) >= 0;
          const advancedRevision = compareRevisions(
            result.revision,
            previousRevision,
          ) > 0;
          appliedRevisionRef.current = result.revision;
          if (streamOnline && !pollingOnly) {
            setStatus("online");
          }
          forceNextRefresh = false;
          if (reachedRequestedRevision) {
            return;
          }
          if (!advancedRevision) {
            setStatus("polling");
            return;
          }
        }
        setStatus("polling");
      })().catch(() => {
        if (!stopped && !accessLost) {
          setStatus("polling");
        }
      });
      refreshInFlight = operation;
      void operation.finally(() => {
        if (refreshInFlight !== operation) {
          return;
        }
        refreshInFlight = null;
        if (
          !stopped
          && !accessLost
          && compareRevisions(requestedRevision, observedRequestedRevision) > 0
          && compareRevisions(requestedRevision, appliedRevisionRef.current) > 0
        ) {
          void refreshAuthoritativeState(requestedRevision);
        }
      });
      return operation;
    };

    const waitBeforeReconnect = (delayMs: number): Promise<void> =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (reconnectWait?.timer === timer) {
            reconnectWait = null;
          }
          resolve();
        }, delayMs);
        reconnectWait = { timer, resolve };
      });

    const runConnection = async () => {
      while (!stopped && !accessLost && !pollingOnly) {
        streamOnline = false;
        setStatus(connectedOnce ? "reconnecting" : "connecting");
        const requestController = new AbortController();
        activeRequest = requestController;
        let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

        try {
          const response = await fetch(`/api/boards/${boardId}/events`, {
            cache: "no-store",
            credentials: "same-origin",
            headers: {
              Accept: "text/event-stream",
              "Last-Event-ID": appliedRevisionRef.current,
            },
            signal: requestController.signal,
          });
          if (response.status === 404) {
            markAccessLost();
            return;
          }
          if (response.status === 429) {
            pollingOnly = true;
            setStatus("polling");
            return;
          }
          if (response.status === 400) {
            pollingOnly = true;
            setStatus("polling");
            return;
          }
          if (!response.ok) {
            throw new Error(`Realtime handshake failed with status ${response.status}`);
          }
          if (!response.headers.get("content-type")?.startsWith("text/event-stream")) {
            throw new SseProtocolError("Realtime response is not an SSE stream");
          }
          if (!response.body) {
            pollingOnly = true;
            setStatus("polling");
            return;
          }

          reader = response.body.getReader();
          const decoder = new TextDecoder();
          const parser = new SseEventParser();
          while (!stopped && !accessLost) {
            const { done, value } = await reader.read();
            const rawEvents = done
              ? [
                  ...parser.push(decoder.decode()),
                  ...parser.finish(),
                ]
              : parser.push(decoder.decode(value, { stream: true }));

            for (const rawEvent of rawEvents) {
              const event = parseBoardSseEvent(rawEvent, boardId);
              streamOnline = true;
              connectedOnce = true;
              reconnectAttempt = 0;
              setStatus("online");
              if (compareRevisions(event.revision, appliedRevisionRef.current) > 0) {
                void refreshAuthoritativeState(event.revision);
              }
            }
            if (done) {
              throw new Error("Realtime stream closed");
            }
          }
        } catch (error) {
          streamOnline = false;
          if (stopped || accessLost || requestController.signal.aborted) {
            return;
          }
          if (error instanceof SseProtocolError) {
            pollingOnly = true;
            setStatus("polling");
            return;
          }
          setStatus("reconnecting");
          const delayMs = getReconnectDelayMs(reconnectAttempt);
          reconnectAttempt += 1;
          await waitBeforeReconnect(delayMs);
        } finally {
          if (activeRequest === requestController) {
            activeRequest = null;
          }
          if (reader) {
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
        }
      }
    };

    const reconcile = () => {
      void refreshAuthoritativeState(undefined, true);
    };
    const reconciliationTimer = setInterval(
      reconcile,
      RECONCILIATION_INTERVAL_MS,
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconcile();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void runConnection();

    return () => {
      stopped = true;
      activeRequest?.abort();
      clearInterval(reconciliationTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectWait) {
        clearTimeout(reconnectWait.timer);
        reconnectWait.resolve();
        reconnectWait = null;
      }
    };
  }, [boardId, enabled, onAccessLost, refreshBoard]);

  return status;
};

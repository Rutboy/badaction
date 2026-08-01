"use client";

import {
  Accessibility,
  AutoScroller,
  PointerActivationConstraints,
  PointerSensor,
} from "@dnd-kit/dom";
import {
  DragDropProvider,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/react";
import { move as moveDndItems } from "@dnd-kit/helpers";
import { isSortable } from "@dnd-kit/react/sortable";
import { GripVertical, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BoardStatusNotice } from "@/components/board/board-status-notice";
import { BoardToolbar } from "@/components/board/board-toolbar";
import { BoardManagementPanel } from "@/components/board/board-management-panel";
import type { BoardManagementSection } from "@/components/board/board-management-types";
import { BoardColumns } from "@/components/board/board-columns";
import {
  boardDndIds,
  buildActionItemPlacement,
  buildColumnPlacement,
  buildItemPlacement,
  moveBoardSnapshot,
  parseBoardDndId,
} from "@/components/board-dnd";
import {
  type BoardRefreshOptions,
  type BoardRefreshResult,
  useBoardRealtime,
} from "@/components/use-board-realtime";
import { Button } from "@/components/ui/button";
import {
  mergeBoardItemsPage,
  mergeBoardRefresh,
  type BoardItem,
  type BoardItemsPage,
  type BoardSnapshot,
} from "@/lib/pagination/board-state";
import { readApiError } from "@/i18n/api-errors";
import type { MessageKey } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import type { Translate } from "@/i18n/translate";

type SnapshotColumn = BoardSnapshot["columns"][number];

type ActionError = { key: string; message: string } | null;

class LocalizedDndError extends Error {}

type ActiveDrag = {
  id: string;
  label: string;
  namespace: "COLUMN" | "ITEM" | "ACTION";
};

const itemGroup = (columnId: string) => boardDndIds.columnDrop(columnId);

const readMutationRevision = async (
  response: Response,
  invalidRevisionMessage: string,
): Promise<string> => {
  const data = (await response.json().catch(() => null)) as {
    revision?: unknown;
  } | null;
  if (typeof data?.revision !== "string" || !/^\d+$/.test(data.revision)) {
    throw new LocalizedDndError(invalidRevisionMessage);
  }
  return data.revision;
};

const revisionIsAtLeast = (actual: string, expected: string): boolean => {
  try {
    return BigInt(actual) >= BigInt(expected);
  } catch {
    return false;
  }
};

const itemRef = (item: BoardItem) => ({ kind: item.kind, id: item.id } as const);

const readDragLabel = (data: unknown, fallback: string | number): string => {
  if (typeof data === "object" && data !== null && "label" in data) {
    const label = data.label;
    if (typeof label === "string" && label.length > 0) {
      return label;
    }
  }
  return String(fallback);
};

const createBoardAccessibility = (t: Translate) => Accessibility.configure({
  screenReaderInstructions: {
    draggable: t("boardShell.dnd.instructions"),
  },
  announcements: {
    dragstart: ({ operation }: DragStartEvent) => {
      const source = operation.source;
      return source
        ? t("boardShell.dnd.dragStart", {
            label: readDragLabel(source.data, source.id),
          })
        : undefined;
    },
    dragover: ({ operation }: DragOverEvent) => {
      const source = operation.source;
      const target = operation.target;
      return source && target
        ? t("boardShell.dnd.dragOver", {
            source: readDragLabel(source.data, source.id),
            target: readDragLabel(target.data, target.id),
          })
        : undefined;
    },
    dragend: ({ operation, canceled }: DragEndEvent) => {
      const source = operation.source;
      if (!source) {
        return undefined;
      }
      return canceled
        ? t("boardShell.dnd.dragCanceled", {
            label: readDragLabel(source.data, source.id),
          })
        : t("boardShell.dnd.dragDropped", {
            label: readDragLabel(source.data, source.id),
          });
    },
  },
  debounce: 250,
});

const BOARD_AUTOSCROLLER = AutoScroller.configure({
  acceleration: 22,
  threshold: { x: 0.16, y: 0.16 },
});

const BOARD_POINTER_SENSOR = PointerSensor.configure({
  activationConstraints(event) {
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      return [
        new PointerActivationConstraints.Delay({
          value: 220,
          tolerance: { x: 8, y: 8 },
        }),
      ];
    }
    return [new PointerActivationConstraints.Distance({ value: 8 })];
  },
});

const findItemColumn = (
  board: BoardSnapshot,
  ref: { kind: "CARD" | "GROUP"; id: string },
): SnapshotColumn | undefined => board.columns.find((column) =>
  column.items.some((item) => item.kind === ref.kind && item.id === ref.id));

type DndBoardItem = {
  id: string;
  item: BoardItem;
};

const withItemColumn = (item: BoardItem, columnId: string): BoardItem => item.kind === "CARD"
  ? { ...item, columnId }
  : {
      ...item,
      columnId,
      cards: item.cards.map((card) => ({ ...card, columnId })),
    };

const moveBoardItemsForDrag = (
  board: BoardSnapshot,
  event: DragOverEvent | DragEndEvent,
): BoardSnapshot => {
  const groups = Object.fromEntries(board.columns.map((column) => [
    itemGroup(column.id),
    column.items.map((item): DndBoardItem => ({
      id: boardDndIds.item(itemRef(item)),
      item,
    })),
  ])) as Record<string, DndBoardItem[]>;
  const movedGroups = moveDndItems(groups, event);
  const changed = board.columns.some((column) =>
    movedGroups[itemGroup(column.id)] !== groups[itemGroup(column.id)]);
  if (!changed) {
    return board;
  }

  return {
    ...board,
    columns: board.columns.map((column) => {
      const groupId = itemGroup(column.id);
      if (movedGroups[groupId] === groups[groupId]) {
        return column;
      }
      const items = movedGroups[groupId].map(({ item }) =>
        item.columnId === column.id ? item : withItemColumn(item, column.id));
      return {
        ...column,
        items,
        totalCount: items.length,
      };
    }),
  };
};

const moveDndSequence = <T,>(
  values: readonly T[],
  getId: (value: T) => string,
  event: DragEndEvent,
): T[] => moveDndItems(
  values.map((value) => ({ id: getId(value), value })),
  event,
).map(({ value }) => value);

export const BoardPageClient = ({
  boardId,
  initialBoard,
}: {
  boardId: string;
  initialBoard: BoardSnapshot;
}) => {
  const { locale, t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;
  const boardAccessibility = useMemo(() => createBoardAccessibility(t), [t]);
  const [board, setBoard] = useState<BoardSnapshot | null>(initialBoard);
  const [error, setError] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<ActionError>(null);
  const [loadingMore, setLoadingMore] = useState<Record<string, boolean>>({});
  const [loadMoreErrors, setLoadMoreErrors] = useState<Record<string, string | null>>({});
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);
  const [dndStatus, setDndStatus] = useState("");
  const [managementSection, setManagementSection] =
    useState<BoardManagementSection | null>(null);
  const [managementColumnId, setManagementColumnId] = useState<string | null>(
    null,
  );
  const loadSequence = useRef(0);
  const accessLost = useRef(false);
  const refreshInFlight = useRef<Promise<BoardRefreshResult> | null>(null);
  const loadMoreSequence = useRef(new Map<string, number>());
  const loadMoreInFlight = useRef(new Set<string>());
  const dragActive = useRef(false);
  const dragSnapshot = useRef<BoardSnapshot | null>(null);
  const dragPreview = useRef<BoardSnapshot | null>(null);
  const dragPreviewTargetId = useRef<string | null>(null);
  const pendingDragRefresh = useRef<BoardSnapshot | null>(null);

  useEffect(() => {
    // Transient messages are already localized strings. Do not leave a stale
    // message from the previous locale beside newly translated controls.
    setSyncError(null);
    setActionError(null);
    setLoadMoreErrors({});
    setDndStatus("");
    if (accessLost.current) {
      setError(t("boardShell.page.accessLost"));
    }
  }, [locale, t]);

  const load = useCallback((options?: BoardRefreshOptions): Promise<BoardRefreshResult> => {
    if (accessLost.current) {
      return Promise.resolve({ status: "access-lost" });
    }
    if (refreshInFlight.current && !options?.force) {
      return refreshInFlight.current;
    }
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setLoading(true);
    const operation = (async (): Promise<BoardRefreshResult> => {
      try {
        const response = await fetch(`/api/boards/${boardId}`, { cache: "no-store" });
        if (sequence !== loadSequence.current) {
          return { status: "retryable" };
        }

        if (response.status === 404) {
          accessLost.current = true;
          setBoard(null);
          setError(tRef.current("boardShell.page.accessLost"));
          return { status: "access-lost" };
        }

        if (!response.ok) {
          setSyncError(await readApiError(
            response,
            tRef.current,
            "boardShell.page.syncFailed",
          ));
          return { status: "retryable" };
        }

        const data = (await response.json()) as BoardSnapshot;
        if (sequence !== loadSequence.current) {
          return { status: "retryable" };
        }

        if (dragActive.current) {
          pendingDragRefresh.current = data;
        } else {
          setBoard((current) => mergeBoardRefresh(current, data));
        }
        setError(null);
        setSyncError(null);
        return { status: "ok", revision: data.revision };
      } catch {
        if (sequence === loadSequence.current) {
          setSyncError(tRef.current("boardShell.page.syncNetworkFailed"));
        }
        return { status: "retryable" };
      } finally {
        if (sequence === loadSequence.current) {
          setLoading(false);
        }
      }
    })();
    refreshInFlight.current = operation;
    void operation.finally(() => {
      if (refreshInFlight.current === operation) {
        refreshInFlight.current = null;
      }
    });
    return operation;
  }, [boardId]);

  const handleAccessLost = useCallback(() => {
    accessLost.current = true;
    loadSequence.current += 1;
    setBoard(null);
    setError(tRef.current("boardShell.page.accessLost"));
  }, []);

  const connectionStatus = useBoardRealtime({
    boardId,
    appliedRevision: board?.revision ?? initialBoard.revision,
    enabled: board !== null && error === null,
    refreshBoard: load,
    onAccessLost: handleAccessLost,
  });

  useEffect(() => {
    const loadMoreSequences = loadMoreSequence.current;
    const inFlightColumns = loadMoreInFlight.current;
    return () => {
      loadSequence.current += 1;
      for (const [columnId, sequence] of loadMoreSequences) {
        loadMoreSequences.set(columnId, sequence + 1);
      }
      inFlightColumns.clear();
    };
  }, []);

  const onLoadMore = async (columnId: string) => {
    const column = board?.columns.find((candidate) => candidate.id === columnId);
    const cursor = column?.nextCursor;
    if (!board || !cursor || loadMoreInFlight.current.has(columnId)) {
      return;
    }

    const requestedRevision = board.revision;
    loadMoreInFlight.current.add(columnId);
    const sequence = (loadMoreSequence.current.get(columnId) ?? 0) + 1;
    loadMoreSequence.current.set(columnId, sequence);
    setLoadingMore((current) => ({ ...current, [columnId]: true }));
    setLoadMoreErrors((current) => ({ ...current, [columnId]: null }));

    try {
      const searchParams = new URLSearchParams({ columnId, cursor });
      const response = await fetch(`/api/boards/${boardId}/cards?${searchParams}`, {
        cache: "no-store",
      });
      if (sequence !== loadMoreSequence.current.get(columnId)) {
        return;
      }

      if (!response.ok) {
        const message = await readApiError(
          response,
          tRef.current,
          "boardShell.page.loadCardsFailed",
        );
        setLoadMoreErrors((current) => ({ ...current, [columnId]: message }));
        return;
      }

      const page = (await response.json()) as BoardItemsPage;
      if (page.columnId !== columnId) {
        setLoadMoreErrors((current) => ({
          ...current,
          [columnId]: tRef.current("boardShell.page.wrongColumnPage"),
        }));
        return;
      }

      if (page.revision !== requestedRevision) {
        await load();
        return;
      }

      setBoard((current) => mergeBoardItemsPage(current, page, cursor));
    } catch {
      if (sequence === loadMoreSequence.current.get(columnId)) {
        setLoadMoreErrors((current) => ({
          ...current,
          [columnId]: tRef.current("boardShell.page.loadCardsNetworkFailed"),
        }));
      }
    } finally {
      if (sequence === loadMoreSequence.current.get(columnId)) {
        loadMoreInFlight.current.delete(columnId);
        setLoadingMore((current) => ({ ...current, [columnId]: false }));
      }
    }
  };

  const onCreateCard = async (columnId: string, text: string, author: string | null) => {
    const key = `create:${columnId}`;
    setSubmitting(key);
    setActionError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, text, author }),
      });

      if (!response.ok) {
        return {
          ok: false as const,
          message: await readApiError(
            response,
            tRef.current,
            "content.card.createFailed",
          ),
        };
      }

      await load();
      toast.success(tRef.current("boardShell.page.cardAdded"));
      return { ok: true as const };
    } catch {
      return {
        ok: false as const,
        message: tRef.current("content.card.createNetworkFailed"),
      };
    } finally {
      setSubmitting(null);
    }
  };

  const onToggleVote = async (cardId: string, viewerHasVoted: boolean) => {
    const key = `vote:${cardId}`;
    setSubmitting(key);
    setActionError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${cardId}/vote`, {
        method: viewerHasVoted ? "DELETE" : "PUT",
      });

      if (!response.ok) {
        setActionError({
          key,
          message: await readApiError(
            response,
            tRef.current,
            viewerHasVoted
              ? "content.vote.removeFailed"
              : "content.vote.addFailed",
          ),
        });
        return;
      }

      await load();
      toast.success(tRef.current(
        viewerHasVoted ? "content.vote.removed" : "content.vote.added",
      ));
    } catch {
      setActionError({
        key,
        message: viewerHasVoted
          ? tRef.current("boardShell.page.removeVoteNetworkFailed")
          : tRef.current("boardShell.page.voteNetworkFailed"),
      });
    } finally {
      setSubmitting(null);
    }
  };

  const commitDndMove = async ({
    previous,
    optimistic,
    path,
    body,
    successKey,
  }: {
    previous: BoardSnapshot;
    optimistic: BoardSnapshot;
    path: string;
    body: unknown;
    successKey: MessageKey;
  }) => {
    const key = "dnd:move";
    let moveWasSaved = false;
    setSubmitting(key);
    setActionError(null);
    setBoard(optimistic);

    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        throw new LocalizedDndError(await readApiError(
          response,
          tRef.current,
          "boardShell.dnd.saveFailed",
        ));
      }

      moveWasSaved = true;
      const savedRevision = await readMutationRevision(
        response,
        tRef.current("boardShell.dnd.invalidRevision"),
      );
      const refreshResult = await load({ force: true });
      if (
        refreshResult.status !== "ok"
        || !revisionIsAtLeast(refreshResult.revision, savedRevision)
      ) {
        throw new LocalizedDndError(tRef.current("boardShell.dnd.savedRefreshFailed"));
      }
      setDndStatus(tRef.current("boardShell.dnd.orderSaved", {
        result: tRef.current(successKey),
      }));
    } catch (moveError) {
      const message = moveError instanceof LocalizedDndError
        ? moveError.message
        : tRef.current("boardShell.dnd.saveFailed");
      if (moveWasSaved) {
        setActionError(null);
        setSyncError(message);
        void load({ force: true });
      } else {
        setBoard(previous);
        setActionError({
          key,
          message: tRef.current("boardShell.dnd.canceledWithError", { message }),
        });
        await load({ force: true });
      }
    } finally {
      setSubmitting(null);
    }
  };

  if (error || !board) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-xl items-center px-4 py-10">
        <section className="w-full space-y-4 border-l-2 border-destructive pl-5">
          <h1 className="text-xl font-semibold">
            {t("boardShell.page.unavailable")}
          </h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {error ?? t("boardShell.page.notFound")}
          </p>
          <Button asChild variant="outline">
            <Link href="/">{t("boardShell.page.backHome")}</Link>
          </Button>
        </section>
      </main>
    );
  }

  const interactionsDisabled = submitting !== null;

  return (
    <DragDropProvider
      sensors={(defaults) => [
        ...defaults.filter((sensor) => sensor !== PointerSensor),
        BOARD_POINTER_SENSOR,
      ]}
      plugins={(defaults) => [
        ...defaults.filter((plugin) =>
          plugin !== Accessibility && plugin !== AutoScroller),
        boardAccessibility,
        BOARD_AUTOSCROLLER,
      ]}
      onDragStart={({ operation }) => {
        const source = operation.source;
        if (!source) {
          return;
        }
        const parsed = parseBoardDndId(source.id);
        if (!parsed || parsed.namespace === "COLUMN_DROP") {
          return;
        }
        dragActive.current = true;
        dragSnapshot.current = board;
        dragPreview.current = board;
        dragPreviewTargetId.current = null;
        pendingDragRefresh.current = null;
        setActionError(null);
        const label = readDragLabel(source.data, source.id);
        setActiveDrag({ id: String(source.id), label, namespace: parsed.namespace });
      }}
      onDragOver={(event) => {
        const { operation } = event;
        const source = operation.source;
        const target = operation.target;
        const parsedSource = source ? parseBoardDndId(source.id) : null;
        if (dragActive.current && parsedSource?.namespace === "ITEM" && target) {
          event.preventDefault();
          const targetId = String(target.id);
          if (dragPreviewTargetId.current === targetId) {
            return;
          }
          dragPreviewTargetId.current = targetId;
          const current = dragPreview.current ?? board;
          const preview = moveBoardItemsForDrag(current, event);
          dragPreview.current = preview;
          if (preview !== current) {
            setBoard(preview);
          }
        } else if (parsedSource?.namespace === "ITEM") {
          dragPreviewTargetId.current = null;
        }
      }}
      onDragEnd={(event) => {
        const { operation, canceled } = event;
        const source = operation.source;
        const target = operation.target;
        const previous = dragSnapshot.current ?? board;
        const preview = dragPreview.current ?? board;
        const pendingRefresh = pendingDragRefresh.current;
        dragActive.current = false;
        dragSnapshot.current = null;
        dragPreview.current = null;
        dragPreviewTargetId.current = null;
        pendingDragRefresh.current = null;
        const sourceLabel = source
          ? readDragLabel(source.data, source.id)
          : t("boardShell.dnd.item");
        setActiveDrag(null);

        if (canceled) {
          setBoard(pendingRefresh
            ? mergeBoardRefresh(previous, pendingRefresh)
            : previous);
          setDndStatus(t("boardShell.dnd.dragCanceled", { label: sourceLabel }));
          return;
        }
        if (!source || !target || !isSortable(source) || interactionsDisabled) {
          setBoard(pendingRefresh
            ? mergeBoardRefresh(previous, pendingRefresh)
            : previous);
          setDndStatus(t("boardShell.dnd.unchanged", { label: sourceLabel }));
          return;
        }

        const parsedSource = parseBoardDndId(source.id);
        if (!parsedSource) {
          setBoard(pendingRefresh
            ? mergeBoardRefresh(previous, pendingRefresh)
            : previous);
          setDndStatus(t("boardShell.dnd.unchanged", { label: sourceLabel }));
          return;
        }

        if (pendingRefresh && pendingRefresh.revision !== previous.revision) {
          setBoard(mergeBoardRefresh(previous, pendingRefresh));
          setActionError({
            key: "dnd:move",
            message: t("boardShell.dnd.changedByParticipant"),
          });
          return;
        }

        try {
          if (parsedSource.namespace === "COLUMN") {
            const finalColumns = moveDndSequence(
              previous.columns,
              (column) => boardDndIds.column(column.id),
              event,
            );
            const targetIndex = finalColumns.findIndex((column) =>
              column.id === parsedSource.columnId);
            const initialIndex = previous.columns.findIndex((column) =>
              column.id === parsedSource.columnId);
            if (initialIndex === targetIndex) {
              setBoard(previous);
              setDndStatus(t("boardShell.dnd.unchanged", { label: sourceLabel }));
              return;
            }
            const optimistic = moveBoardSnapshot(previous, {
              namespace: "COLUMN",
              columnId: parsedSource.columnId,
              targetIndex,
            });
            const placement = buildColumnPlacement(
              optimistic.columns.map((column) => column.id),
              parsedSource.columnId,
            );
            void commitDndMove({
              previous,
              optimistic,
              path: `/api/boards/${boardId}/columns/${parsedSource.columnId}/move`,
              body: { placement, expectedRevision: previous.revision },
              successKey: "boardShell.dnd.columnsUpdated",
            });
            return;
          }

          if (parsedSource.namespace === "ITEM") {
            const sourceColumn = findItemColumn(previous, parsedSource.item);
            if (!sourceColumn) {
              throw new LocalizedDndError(t("boardShell.dnd.itemMissing"));
            }
            const targetColumn = findItemColumn(preview, parsedSource.item);
            const targetColumnId = targetColumn?.id;
            const targetIndex = targetColumn?.items.findIndex((item) =>
              item.kind === parsedSource.item.kind && item.id === parsedSource.item.id) ?? -1;
            if (!targetColumn || targetColumn.nextCursor !== null) {
              throw new LocalizedDndError(t("boardShell.dnd.loadTargetColumn"));
            }
            if (sourceColumn.nextCursor !== null) {
              throw new LocalizedDndError(t("boardShell.dnd.loadSourceColumn"));
            }
            const sourceIndex = sourceColumn.items.findIndex((item) =>
              item.kind === parsedSource.item.kind && item.id === parsedSource.item.id);
            if (targetIndex < 0 || sourceIndex < 0 || !targetColumnId) {
              throw new LocalizedDndError(t("boardShell.dnd.computeFailed"));
            }
            if (sourceColumn.id === targetColumnId && sourceIndex === targetIndex) {
              setBoard(previous);
              setDndStatus(t("boardShell.dnd.unchanged", { label: sourceLabel }));
              return;
            }

            const finalItems = preview.columns
              .find((column) => column.id === targetColumnId)
              ?.items.map(itemRef);
            if (!finalItems) {
              throw new LocalizedDndError(t("boardShell.dnd.computeFailed"));
            }
            const placement = buildItemPlacement(finalItems, parsedSource.item);
            const resource = parsedSource.item.kind === "CARD" ? "cards" : "groups";
            void commitDndMove({
              previous,
              optimistic: preview,
              path: `/api/boards/${boardId}/${resource}/${parsedSource.item.id}/move`,
              body: {
                targetColumnId,
                placement,
                expectedRevision: previous.revision,
              },
              successKey: parsedSource.item.kind === "CARD"
                ? "boardShell.dnd.cardMoved"
                : "boardShell.dnd.groupMoved",
            });
            return;
          }

          if (parsedSource.namespace === "ACTION") {
            const finalActionItems = moveDndSequence(
              previous.actionItems,
              (item) => boardDndIds.action(item.id),
              event,
            );
            const targetIndex = finalActionItems.findIndex((item) =>
              item.id === parsedSource.actionItemId);
            const initialIndex = previous.actionItems.findIndex((item) =>
              item.id === parsedSource.actionItemId);
            if (initialIndex === targetIndex) {
              setBoard(previous);
              setDndStatus(t("boardShell.dnd.unchanged", { label: sourceLabel }));
              return;
            }
            const optimistic = moveBoardSnapshot(previous, {
              namespace: "ACTION",
              actionItemId: parsedSource.actionItemId,
              targetIndex,
            });
            const placement = buildActionItemPlacement(
              optimistic.actionItems.map((item) => item.id),
              parsedSource.actionItemId,
            );
            void commitDndMove({
              previous,
              optimistic,
              path: `/api/boards/${boardId}/action-items/${parsedSource.actionItemId}/move`,
              body: { placement, expectedRevision: previous.revision },
              successKey: "boardShell.dnd.actionsUpdated",
            });
          }
        } catch (dragError) {
          const message = dragError instanceof LocalizedDndError
            ? dragError.message
            : t("boardShell.dnd.computeFailed");
          setBoard(previous);
          setActionError({
            key: "dnd:move",
            message: t("boardShell.dnd.canceledWithError", { message }),
          });
          void load();
        }
      }}
    >
      <main className="flex h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-background">
        <BoardToolbar
          boardId={boardId}
          board={board}
          connectionStatus={connectionStatus}
          loading={loading}
          disabled={interactionsDisabled}
          onChanged={load}
          onOpenManagement={(section) => {
            setManagementColumnId(null);
            setManagementSection(section);
          }}
        />
        <BoardStatusNotice
          board={board}
          connectionStatus={connectionStatus}
          syncError={syncError}
          dndError={actionError?.key === "dnd:move" ? actionError.message : null}
        />

        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {dndStatus}
        </div>
        <p id="board-dnd-instructions" className="sr-only">
          {t("boardShell.dnd.instructions")}
        </p>

        <BoardColumns
          boardId={boardId}
          board={board}
          onCreateCard={onCreateCard}
          onToggleVote={onToggleVote}
          onLoadMore={onLoadMore}
          onChanged={load}
          loadingKey={submitting}
          actionError={actionError}
          loadingMore={loadingMore}
          loadMoreErrors={loadMoreErrors}
          disabled={interactionsDisabled}
          onManageColumn={(columnId) => {
            setManagementColumnId(columnId);
            setManagementSection("columns");
          }}
        />

        {submitting === "dnd:move" ? (
          <div className="pointer-events-none fixed right-[calc(1rem+env(safe-area-inset-right))] bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            {t("boardShell.dnd.saving")}
          </div>
        ) : null}
      </main>

      <BoardManagementPanel
        boardId={boardId}
        board={board}
        onChanged={load}
        disabled={interactionsDisabled}
        open={managementSection !== null}
        activeSection={
          managementSection ?? (board.viewer.role === "OWNER" ? "general" : "access")
        }
        focusedColumnId={managementColumnId}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setManagementSection(null);
            setManagementColumnId(null);
          }
        }}
        onSectionChange={(section) => {
          setManagementColumnId(null);
          setManagementSection(section);
        }}
      />

      <DragOverlay dropAnimation={{ duration: 180, easing: "ease-out" }}>
        {activeDrag ? (
          <div className="max-w-sm rounded-lg border border-primary/20 bg-card px-4 py-3 text-sm font-medium shadow-lg ring-1 ring-primary/15">
            <div className="flex items-center gap-2">
              <GripVertical className="size-4 text-muted-foreground" />
              <span className="line-clamp-2">{activeDrag.label}</span>
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DragDropProvider>
  );
};

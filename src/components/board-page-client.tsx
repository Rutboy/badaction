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
import { useCallback, useEffect, useRef, useState } from "react";
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

type SnapshotColumn = BoardSnapshot["columns"][number];

type ActionError = { key: string; message: string } | null;

type ActiveDrag = {
  id: string;
  label: string;
  namespace: "COLUMN" | "ITEM" | "ACTION";
};

const itemGroup = (columnId: string) => boardDndIds.columnDrop(columnId);

const readApiError = async (response: Response, fallback: string): Promise<string> => {
  const data = (await response.json().catch(() => null)) as {
    error?: { message?: string };
  } | null;
  return data?.error?.message ?? fallback;
};

const readMutationRevision = async (response: Response): Promise<string> => {
  const data = (await response.json().catch(() => null)) as {
    revision?: unknown;
  } | null;
  if (typeof data?.revision !== "string" || !/^\d+$/.test(data.revision)) {
    throw new Error("Порядок сохранён, но сервер вернул некорректную версию доски.");
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

const BOARD_ACCESSIBILITY = Accessibility.configure({
  screenReaderInstructions: {
    draggable:
      "Нажмите Пробел или Enter, чтобы начать перемещение. Используйте стрелки, затем Пробел или Enter для подтверждения. Escape отменяет перемещение.",
  },
  announcements: {
    dragstart: ({ operation }: DragStartEvent) => {
      const source = operation.source;
      return source
        ? `Начато перемещение: ${readDragLabel(source.data, source.id)}.`
        : undefined;
    },
    dragover: ({ operation }: DragOverEvent) => {
      const source = operation.source;
      const target = operation.target;
      return source && target
        ? `${readDragLabel(source.data, source.id)} над ${readDragLabel(target.data, target.id)}.`
        : undefined;
    },
    dragend: ({ operation, canceled }: DragEndEvent) => {
      const source = operation.source;
      if (!source) {
        return undefined;
      }
      return canceled
        ? `Перемещение отменено: ${readDragLabel(source.data, source.id)}.`
        : `${readDragLabel(source.data, source.id)} отпущен. Сохраняем новое положение.`;
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
          setError("Доска не найдена или доступ к ней отозван");
          return { status: "access-lost" };
        }

        if (!response.ok) {
          setSyncError(await readApiError(response, "Не удалось синхронизировать доску"));
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
          setSyncError("Не удалось синхронизировать доску. Проверьте соединение.");
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
    setError("Доска не найдена или доступ к ней отозван");
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
        const message = await readApiError(response, "Не удалось загрузить карточки");
        setLoadMoreErrors((current) => ({ ...current, [columnId]: message }));
        return;
      }

      const page = (await response.json()) as BoardItemsPage;
      if (page.columnId !== columnId) {
        setLoadMoreErrors((current) => ({
          ...current,
          [columnId]: "Сервер вернул страницу другой колонки",
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
          [columnId]: "Не удалось загрузить карточки. Проверьте соединение.",
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
          message: await readApiError(response, "Ошибка создания карточки"),
        };
      }

      await load();
      toast.success("Карточка добавлена");
      return { ok: true as const };
    } catch {
      return {
        ok: false as const,
        message: "Не удалось создать карточку. Проверьте соединение.",
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
            viewerHasVoted ? "Не удалось снять голос" : "Не удалось проголосовать",
          ),
        });
        return;
      }

      await load();
      toast.success(viewerHasVoted ? "Голос снят" : "Голос учтён");
    } catch {
      setActionError({
        key,
        message: viewerHasVoted
          ? "Не удалось снять голос. Проверьте соединение."
          : "Не удалось проголосовать. Проверьте соединение.",
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
    successMessage,
  }: {
    previous: BoardSnapshot;
    optimistic: BoardSnapshot;
    path: string;
    body: unknown;
    successMessage: string;
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
        throw new Error(await readApiError(response, "Не удалось сохранить новый порядок"));
      }

      moveWasSaved = true;
      const savedRevision = await readMutationRevision(response);
      const refreshResult = await load({ force: true });
      if (
        refreshResult.status !== "ok"
        || !revisionIsAtLeast(refreshResult.revision, savedRevision)
      ) {
        throw new Error(
          "Новый порядок сохранён, но получить актуальное состояние доски пока не удалось.",
        );
      }
      setDndStatus(`${successMessage}. Новый порядок сохранён.`);
    } catch (moveError) {
      const message = moveError instanceof Error
        ? moveError.message
        : "Не удалось сохранить новый порядок";
      if (moveWasSaved) {
        setActionError(null);
        setSyncError(message);
        void load({ force: true });
      } else {
        setBoard(previous);
        setActionError({ key, message: `Перемещение отменено. ${message}` });
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
          <h1 className="text-xl font-semibold">Доска недоступна</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {error ?? "Доска не найдена"}
          </p>
          <Button asChild variant="outline">
            <Link href="/">Вернуться на главную</Link>
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
        BOARD_ACCESSIBILITY,
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
          : "Элемент";
        setActiveDrag(null);

        if (canceled) {
          setBoard(pendingRefresh
            ? mergeBoardRefresh(previous, pendingRefresh)
            : previous);
          setDndStatus(`Перемещение отменено: ${sourceLabel}.`);
          return;
        }
        if (!source || !target || !isSortable(source) || interactionsDisabled) {
          setBoard(pendingRefresh
            ? mergeBoardRefresh(previous, pendingRefresh)
            : previous);
          setDndStatus(`Позиция ${sourceLabel} не изменена.`);
          return;
        }

        const parsedSource = parseBoardDndId(source.id);
        if (!parsedSource) {
          setBoard(pendingRefresh
            ? mergeBoardRefresh(previous, pendingRefresh)
            : previous);
          setDndStatus(`Позиция ${sourceLabel} не изменена.`);
          return;
        }

        if (pendingRefresh && pendingRefresh.revision !== previous.revision) {
          setBoard(mergeBoardRefresh(previous, pendingRefresh));
          setActionError({
            key: "dnd:move",
            message:
              "Перемещение отменено. Доска изменилась у другого участника. Повторите действие.",
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
              setDndStatus(`Позиция ${sourceLabel} не изменена.`);
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
              successMessage: "Порядок колонок обновлён",
            });
            return;
          }

          if (parsedSource.namespace === "ITEM") {
            const sourceColumn = findItemColumn(previous, parsedSource.item);
            if (!sourceColumn) {
              throw new Error("Перемещаемый элемент больше не существует");
            }
            const targetColumn = findItemColumn(preview, parsedSource.item);
            const targetColumnId = targetColumn?.id;
            const targetIndex = targetColumn?.items.findIndex((item) =>
              item.kind === parsedSource.item.kind && item.id === parsedSource.item.id) ?? -1;
            if (!targetColumn || targetColumn.nextCursor !== null) {
              throw new Error("Сначала загрузите все карточки целевой колонки");
            }
            if (sourceColumn.nextCursor !== null) {
              throw new Error("Сначала загрузите все карточки исходной колонки");
            }
            const sourceIndex = sourceColumn.items.findIndex((item) =>
              item.kind === parsedSource.item.kind && item.id === parsedSource.item.id);
            if (targetIndex < 0 || sourceIndex < 0 || !targetColumnId) {
              throw new Error("Не удалось вычислить новую позицию");
            }
            if (sourceColumn.id === targetColumnId && sourceIndex === targetIndex) {
              setBoard(previous);
              setDndStatus(`Позиция ${sourceLabel} не изменена.`);
              return;
            }

            const finalItems = preview.columns
              .find((column) => column.id === targetColumnId)
              ?.items.map(itemRef);
            if (!finalItems) {
              throw new Error("Не удалось вычислить новую позицию");
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
              successMessage: parsedSource.item.kind === "CARD"
                ? "Карточка перемещена"
                : "Группа перемещена",
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
              setDndStatus(`Позиция ${sourceLabel} не изменена.`);
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
              successMessage: "Порядок решений обновлён",
            });
          }
        } catch (dragError) {
          const message = dragError instanceof Error
            ? dragError.message
            : "Не удалось вычислить новую позицию";
          setBoard(previous);
          setActionError({
            key: "dnd:move",
            message: `Перемещение отменено. ${message}`,
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
          Нажмите Пробел или Enter, чтобы начать перемещение. Используйте стрелки,
          затем Пробел или Enter для подтверждения. Escape отменяет перемещение.
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
            Сохраняем порядок
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

"use client";

import { Loader2 } from "lucide-react";
import type { BoardConnectionStatus } from "@/components/use-board-realtime";
import { cn } from "@/lib/utils";

const CONNECTION_STATUS: Record<
  BoardConnectionStatus,
  { label: string; dot: string; hint: string }
> = {
  connecting: {
    label: "Подключение…",
    dot: "bg-amber-500",
    hint: "Подключаем realtime-обновления.",
  },
  online: {
    label: "Онлайн",
    dot: "bg-emerald-600",
    hint: "Изменения сохраняются автоматически.",
  },
  reconnecting: {
    label: "Переподключение…",
    dot: "bg-amber-500",
    hint: "Восстанавливаем realtime-соединение.",
  },
  polling: {
    label: "Резервное обновление",
    dot: "bg-zinc-500",
    hint: "Доска периодически сверяется с сервером.",
  },
};

export const ConnectionIndicator = ({
  status,
  loading,
}: {
  status: BoardConnectionStatus;
  loading: boolean;
}) => {
  const connection = CONNECTION_STATUS[status];
  const compact = status === "online" && !loading;

  return (
    <div className="group relative shrink-0">
      <div
        role="status"
        tabIndex={0}
        aria-label={`Состояние синхронизации: ${connection.label}`}
        aria-describedby="board-sync-tooltip"
        aria-live="polite"
        className={cn(
          "flex h-10 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 max-sm:h-11",
          compact && "w-10 justify-center px-0 max-sm:w-11",
        )}
      >
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <span
            aria-hidden="true"
            className={cn("size-2 rounded-full", connection.dot)}
          />
        )}
        {compact ? (
          <span className="sr-only">{connection.label}</span>
        ) : (
          connection.label
        )}
      </div>
      <div
        id="board-sync-tooltip"
        role="tooltip"
        className="pointer-events-none absolute top-full right-0 z-50 mt-2 hidden w-60 rounded-md border bg-popover px-3 py-2 text-xs leading-5 text-popover-foreground shadow-md group-hover:block group-focus-within:block"
      >
        {connection.hint}
      </div>
    </div>
  );
};

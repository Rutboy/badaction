"use client";

import { Loader2 } from "lucide-react";
import type { BoardConnectionStatus } from "@/components/use-board-realtime";
import type { MessageKey } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import { cn } from "@/lib/utils";

const CONNECTION_STATUS: Record<
  BoardConnectionStatus,
  { labelKey: MessageKey; dot: string; hintKey: MessageKey }
> = {
  connecting: {
    labelKey: "boardShell.connection.connectingLabel",
    dot: "bg-amber-500",
    hintKey: "boardShell.connection.connectingHint",
  },
  online: {
    labelKey: "boardShell.connection.onlineLabel",
    dot: "bg-emerald-600",
    hintKey: "boardShell.connection.onlineHint",
  },
  reconnecting: {
    labelKey: "boardShell.connection.reconnectingLabel",
    dot: "bg-amber-500",
    hintKey: "boardShell.connection.reconnectingHint",
  },
  polling: {
    labelKey: "boardShell.connection.pollingLabel",
    dot: "bg-zinc-500",
    hintKey: "boardShell.connection.pollingHint",
  },
};

export const ConnectionIndicator = ({
  status,
  loading,
}: {
  status: BoardConnectionStatus;
  loading: boolean;
}) => {
  const { t } = useI18n();
  const connectionConfig = CONNECTION_STATUS[status];
  const connection = {
    ...connectionConfig,
    label: t(connectionConfig.labelKey),
    hint: t(connectionConfig.hintKey),
  };
  const compact = status === "online" && !loading;

  return (
    <div className="group relative shrink-0">
      <div
        role="status"
        tabIndex={0}
        aria-label={t("boardShell.connection.ariaLabel", {
          status: connection.label,
        })}
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

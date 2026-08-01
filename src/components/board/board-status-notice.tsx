"use client";

import { AlertTriangle, Eye, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import type { BoardConnectionStatus } from "@/components/use-board-realtime";
import type { BoardSnapshot } from "@/lib/pagination/board-state";

export const PERSISTENT_CONNECTION_NOTICE_DELAY_MS = 10_000;

const readModeMessage = (board: BoardSnapshot): string | null => {
  if (board.settings.readOnly) {
    return "Доска открыта только для чтения — содержимое временно нельзя изменять.";
  }
  if (!board.settings.cardsEnabled && !board.settings.votingEnabled) {
    return "Сбор карточек и голосование выключены владельцем.";
  }
  if (!board.settings.cardsEnabled) {
    return "Сбор карточек выключен, но голосование остаётся доступным.";
  }
  if (!board.settings.votingEnabled) {
    return "Голосование выключено, карточки по-прежнему можно добавлять.";
  }
  return null;
};

export const BoardStatusNotice = ({
  board,
  connectionStatus,
  syncError,
  dndError,
}: {
  board: BoardSnapshot;
  connectionStatus: BoardConnectionStatus;
  syncError: string | null;
  dndError: string | null;
}) => {
  const modeMessage = readModeMessage(board);
  const hasDegradedConnection =
    connectionStatus === "reconnecting" || connectionStatus === "polling";
  const [showPersistentConnectionNotice, setShowPersistentConnectionNotice] =
    useState(false);

  useEffect(() => {
    if (!hasDegradedConnection) {
      setShowPersistentConnectionNotice(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      setShowPersistentConnectionNotice(true);
    }, PERSISTENT_CONNECTION_NOTICE_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [hasDegradedConnection]);

  const persistentConnectionMessage =
    connectionStatus === "reconnecting"
      ? "Realtime-соединение прервано. Изменения будут сверены после восстановления связи."
      : connectionStatus === "polling"
        ? "Realtime недоступен — доска обновляется периодической сверкой."
        : null;
  const visiblePersistentConnectionMessage = showPersistentConnectionNotice
    ? persistentConnectionMessage
    : null;

  if (
    !modeMessage &&
    !visiblePersistentConnectionMessage &&
    !syncError &&
    !dndError
  ) {
    return null;
  }

  return (
    <div className="border-b bg-secondary/70 py-2 pr-[calc(1rem+env(safe-area-inset-right))] pl-[calc(1rem+env(safe-area-inset-left))] text-xs sm:pr-[calc(1.5rem+env(safe-area-inset-right))] sm:pl-[calc(1.5rem+env(safe-area-inset-left))]">
      <div className="mx-auto flex max-w-[1680px] flex-wrap items-center gap-x-5 gap-y-1">
        {modeMessage ? (
          <p className="flex items-center gap-2 text-foreground" role="status">
            <Eye
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {modeMessage}
          </p>
        ) : null}
        {visiblePersistentConnectionMessage || syncError ? (
          <p className="flex items-center gap-2 text-amber-900">
            <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
            {visiblePersistentConnectionMessage ? (
              <span aria-hidden="true">
                {visiblePersistentConnectionMessage}
              </span>
            ) : null}
            {syncError ? (
              <span role="alert">
                {syncError} Последняя загруженная версия остаётся на экране.
              </span>
            ) : null}
          </p>
        ) : null}
        {dndError ? (
          <p className="flex items-center gap-2 text-destructive" role="alert">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
            {dndError}
          </p>
        ) : null}
      </div>
    </div>
  );
};

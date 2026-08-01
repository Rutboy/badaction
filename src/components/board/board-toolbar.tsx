"use client";

import {
  CalendarClock,
  Check,
  Columns3,
  Download,
  Ellipsis,
  Pencil,
  Plus,
  Settings2,
  Share2,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ConnectionIndicator } from "@/components/board/connection-indicator";
import type { BoardManagementSection } from "@/components/board/board-management-types";
import { QuickColumnDialog } from "@/components/board/quick-column-dialog";
import type {
  BoardConnectionStatus,
  BoardRefreshOptions,
  BoardRefreshResult,
} from "@/components/use-board-realtime";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { readApiError } from "@/i18n/api-errors";
import { useI18n } from "@/i18n/provider";
import type { BoardSnapshot } from "@/lib/pagination/board-state";

export const BoardToolbar = ({
  boardId,
  board,
  connectionStatus,
  loading,
  disabled,
  onChanged,
  onOpenManagement,
}: {
  boardId: string;
  board: BoardSnapshot;
  connectionStatus: BoardConnectionStatus;
  loading: boolean;
  disabled: boolean;
  onChanged: (options?: BoardRefreshOptions) => Promise<BoardRefreshResult>;
  onOpenManagement: (section: BoardManagementSection) => void;
}) => {
  const { locale, t } = useI18n();
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(board.title);
  const [savingTitle, setSavingTitle] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [quickColumnOpen, setQuickColumnOpen] = useState(false);
  const titleTriggerRef = useRef<HTMLButtonElement>(null);
  const quickColumnTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const quickColumnReturnFocusRef = useRef<HTMLElement | null>(null);
  const titleBeforeEdit = useRef(board.title);
  const isOwner = board.viewer.role === "OWNER";

  useEffect(() => setTitleError(null), [locale]);

  const beginTitleEdit = () => {
    titleBeforeEdit.current = board.title;
    setTitle(board.title);
    setTitleError(null);
    setEditingTitle(true);
  };

  const cancelTitleEdit = () => {
    if (savingTitle) return;
    setTitle(titleBeforeEdit.current);
    setTitleError(null);
    setEditingTitle(false);
    requestAnimationFrame(() => titleTriggerRef.current?.focus());
  };

  const saveTitle = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || normalizedTitle.length > 120) {
      setTitleError(t("boardShell.toolbar.titleLength"));
      return;
    }
    if (normalizedTitle === board.title) {
      setEditingTitle(false);
      requestAnimationFrame(() => titleTriggerRef.current?.focus());
      return;
    }

    setSavingTitle(true);
    setTitleError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: normalizedTitle }),
      });
      if (!response.ok) {
        setTitleError(
          await readApiError(response, t, "boardShell.toolbar.renameFailed"),
        );
        return;
      }
      await onChanged();
      setEditingTitle(false);
      requestAnimationFrame(() => titleTriggerRef.current?.focus());
    } catch {
      setTitleError(t("boardShell.toolbar.renameNetworkFailed"));
    } finally {
      setSavingTitle(false);
    }
  };

  return (
    <header
      data-testid="board-toolbar"
      className="relative z-20 min-h-16 shrink-0 border-b bg-background pt-[calc(0.5rem+env(safe-area-inset-top))] pr-[calc(1rem+env(safe-area-inset-right))] pb-2 pl-[calc(1rem+env(safe-area-inset-left))] sm:pr-[calc(1.5rem+env(safe-area-inset-right))] sm:pl-[calc(1.5rem+env(safe-area-inset-left))]"
    >
      <div className="mx-auto flex min-h-12 max-w-[1680px] items-center gap-3">
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <form
              noValidate
              className="flex max-w-2xl items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTitle();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  cancelTitleEdit();
                }
              }}
            >
              <div className="min-w-0 flex-1">
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={120}
                  aria-label={t("boardShell.toolbar.titleLabel")}
                  aria-invalid={Boolean(titleError)}
                  aria-describedby={
                    titleError ? "board-title-error" : undefined
                  }
                  disabled={savingTitle}
                  autoFocus
                  className="h-9 text-base font-semibold sm:text-lg"
                />
                {titleError ? (
                  <p
                    id="board-title-error"
                    role="alert"
                    className="absolute top-full left-4 mt-1 rounded-md border bg-popover px-2 py-1 text-xs text-destructive shadow-md sm:left-6"
                  >
                    {titleError}
                  </p>
                ) : null}
              </div>
              <Button
                type="submit"
                variant="ghost"
                size="icon"
                aria-label={t("boardShell.toolbar.saveTitle")}
                disabled={savingTitle}
              >
                <Check className="size-4" aria-hidden="true" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("boardShell.toolbar.cancelRename")}
                disabled={savingTitle}
                onClick={cancelTitleEdit}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <h1
                className="min-w-0 truncate text-lg font-semibold tracking-tight sm:text-xl"
                title={board.title}
              >
                {board.title}
              </h1>
              {isOwner && board.capabilities.canManageSettings ? (
                <Button
                  ref={titleTriggerRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0 text-muted-foreground"
                  aria-label={t("boardShell.toolbar.rename")}
                  disabled={disabled}
                  onClick={beginTitleEdit}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          )}
        </div>

        <ConnectionIndicator status={connectionStatus} loading={loading} />

        {isOwner ? (
          <>
            <Button
              ref={quickColumnTriggerRef}
              type="button"
              variant="outline"
              className="hidden lg:inline-flex"
              disabled={disabled || !board.capabilities.canManageColumns}
              aria-label={t("boardShell.toolbar.addColumn")}
              onClick={() => {
                quickColumnReturnFocusRef.current =
                  quickColumnTriggerRef.current;
                setQuickColumnOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("boardShell.toolbar.column")}
            </Button>
            <Button
              type="button"
              className="max-sm:size-11 max-sm:px-0"
              disabled={disabled || !board.capabilities.canManageAccess}
              onClick={() => onOpenManagement("access")}
            >
              <Share2 className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">
                {t("boardShell.toolbar.invite")}
              </span>
              <span className="sr-only sm:hidden">
                {t("boardShell.toolbar.invite")}
              </span>
            </Button>
          </>
        ) : null}

        <button
          type="button"
          className="hidden max-w-36 items-center gap-2 truncate rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:flex"
          aria-label={t("boardShell.toolbar.currentParticipant", {
            name: board.viewer.displayName,
          })}
          onClick={() => onOpenManagement("access")}
        >
          <UserRound className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{board.viewer.displayName}</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={overflowTriggerRef}
              type="button"
              size="icon"
              variant="ghost"
              className="max-sm:size-11"
              aria-label={t("boardShell.toolbar.moreActions")}
            >
              <Ellipsis className="size-5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              {board.viewer.displayName}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {isOwner ? (
              <>
                <DropdownMenuItem
                  disabled={disabled || !board.capabilities.canManageColumns}
                  onSelect={() => {
                    quickColumnReturnFocusRef.current =
                      overflowTriggerRef.current;
                    setQuickColumnOpen(true);
                  }}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t("boardShell.toolbar.addColumn")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenManagement("general")}>
                  <Settings2 className="size-4" aria-hidden="true" />
                  {t("boardShell.toolbar.settings")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenManagement("columns")}>
                  <Columns3 className="size-4" aria-hidden="true" />
                  {t("boardShell.toolbar.manageColumns")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenManagement("access")}>
                  <ShieldCheck className="size-4" aria-hidden="true" />
                  {t("boardShell.toolbar.manageAccess")}
                </DropdownMenuItem>
              </>
            ) : (
              <DropdownMenuItem onSelect={() => onOpenManagement("access")}>
                <UserRound className="size-4" aria-hidden="true" />
                {t("boardShell.toolbar.participation")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onOpenManagement("export")}>
              <Download className="size-4" aria-hidden="true" />
              {t("boardShell.toolbar.export")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onOpenManagement("about")}>
              <CalendarClock className="size-4" aria-hidden="true" />
              {t("boardShell.toolbar.retention")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <QuickColumnDialog
        boardId={boardId}
        board={board}
        open={quickColumnOpen}
        onOpenChange={setQuickColumnOpen}
        onChanged={onChanged}
        returnFocusRef={quickColumnReturnFocusRef}
      />
    </header>
  );
};

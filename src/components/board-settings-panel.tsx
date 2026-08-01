"use client";

import {
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useMemo, useRef, useState, useEffect } from "react";
import { toast } from "sonner";
import type { BoardManagementSection } from "@/components/board/board-management-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { readApiError } from "@/i18n/api-errors";
import type { Locale } from "@/i18n/locales";
import type { MessageKey } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
import type { Translate } from "@/i18n/translate";
import type { BoardSnapshot } from "@/lib/pagination/board-state";

type SettingsSection = Extract<
  BoardManagementSection,
  "general" | "columns" | "danger"
>;

type ColumnDraft = {
  title: string;
  voteLimit: string;
};

type DeleteStrategy = "" | "moveCards" | "deleteCards";

type LocalizedError = {
  locale: Locale;
  message: string;
};

class PanelRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PanelRequestError";
  }
}

const jsonRequest = async (
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  t: Translate,
  fallbackKey: MessageKey,
): Promise<unknown> => {
  let response: Response;

  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(t("errors.network"));
  }

  if (!response.ok) {
    throw new PanelRequestError(
      await readApiError(response, t, fallbackKey),
      response.status,
    );
  }

  return response.json().catch(() => null);
};

const checkboxClassName =
  "mt-0.5 size-4 shrink-0 accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

const selectClassName =
  "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";

const sectionHeadingClassName = "text-base font-semibold tracking-tight";

export const BoardSettingsContent = ({
  boardId,
  board,
  onChanged,
  section,
  open,
  focusedColumnId = null,
  disabled = false,
}: {
  boardId: string;
  board: BoardSnapshot;
  onChanged: () => Promise<unknown>;
  section: SettingsSection;
  open: boolean;
  focusedColumnId?: string | null;
  disabled?: boolean;
}) => {
  const { formatNumber, locale, t } = useI18n();
  const i18nRef = useRef({ locale, t });
  const [action, setAction] = useState<string | null>(null);
  const [errors, setErrors] = useState<
    Partial<Record<SettingsSection, LocalizedError>>
  >({});
  const [title, setTitle] = useState(board.title);
  const [cardsEnabled, setCardsEnabled] = useState(board.settings.cardsEnabled);
  const [votingEnabled, setVotingEnabled] = useState(board.settings.votingEnabled);
  const [readOnly, setReadOnly] = useState(board.settings.readOnly);
  const [columnDrafts, setColumnDrafts] = useState<Record<string, ColumnDraft>>({});
  const [newColumnTitle, setNewColumnTitle] = useState("");
  const [newColumnVoteLimit, setNewColumnVoteLimit] = useState("3");
  const [deleteColumnId, setDeleteColumnId] = useState<string | null>(null);
  const [deleteStrategy, setDeleteStrategy] = useState<DeleteStrategy>("");
  const [deleteTargetColumnId, setDeleteTargetColumnId] = useState("");
  const [deleteCardsConfirmation, setDeleteCardsConfirmation] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState("");
  const wasOpen = useRef(false);

  useEffect(() => {
    i18nRef.current = { locale, t };
  }, [locale, t]);

  useEffect(() => {
    if (!open || section !== "columns" || !focusedColumnId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const input = document.getElementById(
        `column-title-${focusedColumnId}`,
      );
      if (!(input instanceof HTMLInputElement)) {
        return;
      }
      input.scrollIntoView({ block: "center", behavior: "auto" });
      input.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedColumnId, open, section]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setTitle(board.title);
      setCardsEnabled(board.settings.cardsEnabled);
      setVotingEnabled(board.settings.votingEnabled);
      setReadOnly(board.settings.readOnly);
      setColumnDrafts(Object.fromEntries(board.columns.map((column) => [
        column.id,
        {
          title: column.title,
          voteLimit: String(column.voteLimit),
        },
      ])));
      setNewColumnTitle("");
      setNewColumnVoteLimit("3");
      setDeleteColumnId(null);
      setDeleteStrategy("");
      setDeleteTargetColumnId("");
      setDeleteCardsConfirmation("");
      setResetOpen(false);
      setResetConfirmation("");
      setErrors({});
    }
    wasOpen.current = open;
  }, [board, open]);

  const busy = disabled || action !== null;

  const setSectionError = (
    target: SettingsSection,
    message: string | null,
    errorLocale: Locale = locale,
  ) => {
    setErrors((current) => {
      if (message === null) {
        const next = { ...current };
        delete next[target];
        return next;
      }
      return { ...current, [target]: { locale: errorLocale, message } };
    });
  };

  const sectionError = (target: SettingsSection): string | null => {
    const error = errors[target];
    return error?.locale === locale ? error.message : null;
  };

  const runMutation = async <Result,>(
    target: SettingsSection,
    key: string,
    operation: () => Promise<Result>,
    successKey: MessageKey,
  ): Promise<Result | null> => {
    const operationLocale = locale;
    setAction(key);
    setSectionError(target, null);

    try {
      const result = await operation();
      try {
        await onChanged();
      } catch {
        const currentI18n = i18nRef.current;
        setSectionError(
          target,
          currentI18n.t("settings.errors.savedRefreshFailed"),
          currentI18n.locale,
        );
        return result;
      }
      toast.success(i18nRef.current.t(successKey));
      return result;
    } catch (error) {
      if (error instanceof PanelRequestError && error.status === 409) {
        try {
          await onChanged();
        } catch {
          // Preserve the actionable conflict returned by the mutation.
        }
      }
      setSectionError(
        target,
        error instanceof Error ? error.message : t("settings.errors.actionFailed"),
        operationLocale,
      );
      return null;
    } finally {
      setAction(null);
    }
  };

  const trimmedTitle = title.trim();
  const boardSettingsChanged = trimmedTitle !== board.title
    || cardsEnabled !== board.settings.cardsEnabled
    || votingEnabled !== board.settings.votingEnabled
    || readOnly !== board.settings.readOnly;
  const titleInvalid = trimmedTitle.length < 1 || trimmedTitle.length > 120;

  const saveBoardSettings = async () => {
    if (titleInvalid || !boardSettingsChanged) {
      return;
    }

    await runMutation(
      "general",
      "board-settings",
      () => jsonRequest(
        `/api/boards/${boardId}`,
        "PATCH",
        {
          title: trimmedTitle,
          cardsEnabled,
          votingEnabled,
          readOnly,
        },
        t,
        "settings.errors.saveBoard",
      ),
      "settings.general.savedToast",
    );
  };

  const createColumnVoteLimit = Number(newColumnVoteLimit);
  const createColumnInvalid = newColumnTitle.trim().length < 1
    || newColumnTitle.trim().length > 80
    || newColumnVoteLimit.trim().length === 0
    || !Number.isInteger(createColumnVoteLimit)
    || createColumnVoteLimit < 0
    || createColumnVoteLimit > 20;

  const createColumn = async () => {
    if (createColumnInvalid) {
      return;
    }

    const lastColumn = board.columns.at(-1) ?? null;
    const result = await runMutation(
      "columns",
      "create-column",
      () => jsonRequest(
        `/api/boards/${boardId}/columns`,
        "POST",
        {
          title: newColumnTitle.trim(),
          voteLimit: createColumnVoteLimit,
          placement: {
            beforeColumnId: lastColumn?.id ?? null,
            afterColumnId: null,
          },
          expectedRevision: board.revision,
        },
        t,
        "settings.errors.createColumn",
      ),
      "settings.columns.createdToast",
    );

    if (result !== null) {
      setNewColumnTitle("");
      setNewColumnVoteLimit("3");
    }
  };

  const saveColumn = async (columnId: string) => {
    const column = board.columns.find((candidate) => candidate.id === columnId);
    const draft = columnDrafts[columnId];
    if (!column || !draft) {
      return;
    }

    const nextTitle = draft.title.trim();
    const nextVoteLimit = Number(draft.voteLimit);
    if (
      nextTitle.length < 1
      || nextTitle.length > 80
      || draft.voteLimit.trim().length === 0
      || !Number.isInteger(nextVoteLimit)
      || nextVoteLimit < 0
      || nextVoteLimit > 20
    ) {
      return;
    }

    const payload: {
      title?: string;
      voteLimit?: number;
      expectedRevision?: string;
    } = {};
    if (nextTitle !== column.title) {
      payload.title = nextTitle;
    }
    if (nextVoteLimit !== column.voteLimit) {
      payload.voteLimit = nextVoteLimit;
      payload.expectedRevision = board.revision;
    }
    if (payload.title === undefined && payload.voteLimit === undefined) {
      return;
    }

    await runMutation(
      "columns",
      `save-column:${columnId}`,
      () => jsonRequest(
        `/api/boards/${boardId}/columns/${columnId}`,
        "PATCH",
        payload,
        t,
        "settings.errors.saveColumn",
      ),
      "settings.columns.updatedToast",
    );
  };

  const selectedDeleteColumn = useMemo(
    () => board.columns.find((column) => column.id === deleteColumnId) ?? null,
    [board.columns, deleteColumnId],
  );
  const selectedDeleteColumnIsEmpty = selectedDeleteColumn?.totalCount === 0;

  const beginDeleteColumn = (columnId: string) => {
    setDeleteColumnId(columnId);
    setDeleteStrategy("");
    setDeleteTargetColumnId("");
    setDeleteCardsConfirmation("");
    setSectionError("columns", null);
  };

  const deleteColumn = async () => {
    if (!selectedDeleteColumn || board.columns.length <= 1) {
      return;
    }
    if (!selectedDeleteColumnIsEmpty && !board.settings.cardsEnabled) {
      setSectionError(
        "columns",
        t("settings.columns.enableCardsFirst"),
      );
      return;
    }

    let payload: unknown;
    if (selectedDeleteColumnIsEmpty) {
      payload = { expectedRevision: board.revision };
    } else if (deleteStrategy === "moveCards") {
      if (!deleteTargetColumnId || deleteTargetColumnId === selectedDeleteColumn.id) {
        return;
      }
      payload = {
        strategy: "moveCards",
        targetColumnId: deleteTargetColumnId,
        expectedRevision: board.revision,
      };
    } else if (deleteStrategy === "deleteCards") {
      if (deleteCardsConfirmation !== t("settings.columns.deleteToken")) {
        return;
      }
      payload = {
        strategy: "deleteCards",
        confirmDeleteCards: true,
        expectedRevision: board.revision,
      };
    } else {
      return;
    }

    const result = await runMutation(
      "columns",
      `delete-column:${selectedDeleteColumn.id}`,
      () => jsonRequest(
        `/api/boards/${boardId}/columns/${selectedDeleteColumn.id}`,
        "DELETE",
        payload,
        t,
        "settings.errors.deleteColumn",
      ),
      "settings.columns.deletedToast",
    );

    if (result !== null) {
      setDeleteColumnId(null);
    }
  };

  const resetVotes = async () => {
    if (resetConfirmation !== t("settings.danger.resetToken")) {
      return;
    }

    const result = await runMutation(
      "danger",
      "reset-votes",
      () => jsonRequest(
        `/api/boards/${boardId}/votes/reset`,
        "POST",
        {
          confirmation: "RESET_VOTES",
          expectedRevision: board.revision,
        },
        t,
        "settings.errors.resetVotes",
      ),
      "settings.danger.resetToast",
    );

    if (result !== null) {
      setResetOpen(false);
      setResetConfirmation("");
    }
  };

  if (section === "general") {
    return (
      <section className="space-y-6" aria-labelledby="board-settings-heading">
        <div className="space-y-1">
          <h2 id="board-settings-heading" className={sectionHeadingClassName}>
            {t("settings.general.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("settings.general.description")}
          </p>
        </div>

        {sectionError("general") ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {sectionError("general")}
          </p>
        ) : null}

        <form
          noValidate
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void saveBoardSettings();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="board-settings-title" className="text-sm font-medium">
              {t("settings.general.boardTitle")}
            </label>
            <Input
              id="board-settings-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={120}
              disabled={busy || !board.capabilities.canManageSettings}
              aria-invalid={titleInvalid}
              aria-describedby={titleInvalid ? "board-settings-title-error" : undefined}
            />
            {titleInvalid ? (
              <p id="board-settings-title-error" className="text-xs text-destructive">
                {t("settings.general.titleValidation")}
              </p>
            ) : null}
          </div>

          <fieldset
            className="divide-y rounded-lg border"
            disabled={busy || !board.capabilities.canManageSettings}
          >
            <legend className="sr-only">{t("settings.general.modesLegend")}</legend>
            <label className="flex cursor-pointer items-start gap-3 p-4 text-sm">
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={cardsEnabled}
                onChange={(event) => setCardsEnabled(event.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("settings.general.cardsTitle")}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {t("settings.general.cardsDescription")}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 p-4 text-sm">
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={votingEnabled}
                onChange={(event) => setVotingEnabled(event.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("settings.general.votingTitle")}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {t("settings.general.votingDescription")}
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 p-4 text-sm">
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={readOnly}
                onChange={(event) => setReadOnly(event.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{t("settings.general.readOnlyTitle")}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  {t("settings.general.readOnlyDescription")}
                </span>
              </span>
            </label>
          </fieldset>

          <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t bg-background px-1 py-4">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {boardSettingsChanged
                ? t("settings.general.unsaved")
                : t("settings.general.saved")}
            </p>
            <Button
              type="submit"
              disabled={
                busy
                || !board.capabilities.canManageSettings
                || titleInvalid
                || !boardSettingsChanged
              }
            >
              {action === "board-settings"
                ? <Loader2 className="size-4 animate-spin" />
                : <Save className="size-4" />}
              {t("settings.general.saveButton")}
            </Button>
          </div>
        </form>
      </section>
    );
  }

  if (section === "columns") {
    return (
      <section className="space-y-6" aria-labelledby="columns-settings-heading">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h2 id="columns-settings-heading" className={sectionHeadingClassName}>
              {t("settings.columns.heading")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("settings.columns.description")}
            </p>
          </div>
          <Badge variant="outline">{formatNumber(board.columns.length)}</Badge>
        </div>

        {sectionError("columns") && selectedDeleteColumn === null ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {sectionError("columns")}
          </p>
        ) : null}

        {!board.capabilities.canManageColumns ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            {t("settings.columns.readOnlyNotice")}
          </p>
        ) : null}

        <ul className="divide-y rounded-lg border">
          {board.columns.map((column) => {
            const draft = columnDrafts[column.id] ?? {
              title: column.title,
              voteLimit: String(column.voteLimit),
            };
            const draftVoteLimit = Number(draft.voteLimit);
            const draftInvalid = draft.title.trim().length < 1
              || draft.title.trim().length > 80
              || draft.voteLimit.trim().length === 0
              || !Number.isInteger(draftVoteLimit)
              || draftVoteLimit < 0
              || draftVoteLimit > 20;
            const changed = draft.title.trim() !== column.title
              || draftVoteLimit !== column.voteLimit;

            return (
              <li key={column.id} className="p-4">
                <form
                  noValidate
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveColumn(column.id);
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
                    <div className="space-y-2">
                      <label htmlFor={`column-title-${column.id}`} className="text-xs font-medium text-muted-foreground">
                        {t("settings.columns.titleLabel")}
                      </label>
                      <Input
                        id={`column-title-${column.id}`}
                        value={draft.title}
                        maxLength={80}
                        disabled={busy || !board.capabilities.canManageColumns}
                        aria-invalid={draft.title.trim().length < 1 || draft.title.trim().length > 80}
                        onChange={(event) => setColumnDrafts((current) => ({
                          ...current,
                          [column.id]: { ...draft, title: event.target.value },
                        }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor={`column-vote-limit-${column.id}`} className="text-xs font-medium text-muted-foreground">
                        {t("settings.columns.voteLimitLabel")}
                      </label>
                      <Input
                        id={`column-vote-limit-${column.id}`}
                        type="number"
                        min={0}
                        max={20}
                        step={1}
                        inputMode="numeric"
                        required
                        value={draft.voteLimit}
                        disabled={busy || !board.capabilities.canManageColumns}
                        aria-invalid={draft.voteLimit.trim().length === 0 || !Number.isInteger(draftVoteLimit) || draftVoteLimit < 0 || draftVoteLimit > 20}
                        onChange={(event) => setColumnDrafts((current) => ({
                          ...current,
                          [column.id]: { ...draft, voteLimit: event.target.value },
                        }))}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t("settings.columns.itemCount", {
                        count: column.totalCount,
                        formattedCount: formatNumber(column.totalCount),
                      })}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={
                          busy
                          || !board.capabilities.canManageColumns
                          || board.columns.length <= 1
                        }
                        onClick={() => beginDeleteColumn(column.id)}
                      >
                        <Trash2 className="size-4" />
                        {t("settings.columns.deleteButton")}
                      </Button>
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        disabled={
                          busy
                          || !board.capabilities.canManageColumns
                          || draftInvalid
                          || !changed
                        }
                      >
                        {action === `save-column:${column.id}`
                          ? <Loader2 className="size-4 animate-spin" />
                          : <Save className="size-4" />}
                        {t("settings.columns.saveButton")}
                      </Button>
                    </div>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>

        <form
          noValidate
          className="space-y-4 rounded-lg border bg-secondary/35 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createColumn();
          }}
        >
          <div>
            <h3 className="text-sm font-semibold">{t("settings.columns.newHeading")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("settings.columns.newDescription")}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
            <div className="space-y-2">
              <label htmlFor="new-column-title" className="text-xs font-medium text-muted-foreground">
                {t("settings.columns.titleLabel")}
              </label>
              <Input
                id="new-column-title"
                value={newColumnTitle}
                maxLength={80}
                disabled={busy || !board.capabilities.canManageColumns}
                onChange={(event) => setNewColumnTitle(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="new-column-vote-limit" className="text-xs font-medium text-muted-foreground">
                {t("settings.columns.voteLimitLabel")}
              </label>
              <Input
                id="new-column-vote-limit"
                type="number"
                min={0}
                max={20}
                step={1}
                inputMode="numeric"
                required
                value={newColumnVoteLimit}
                disabled={busy || !board.capabilities.canManageColumns}
                onChange={(event) => setNewColumnVoteLimit(event.target.value)}
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={
              busy
              || !board.capabilities.canManageColumns
              || createColumnInvalid
            }
          >
            {action === "create-column"
              ? <Loader2 className="size-4 animate-spin" />
              : <Plus className="size-4" />}
            {t("settings.columns.addButton")}
          </Button>
        </form>

        <Dialog
          open={selectedDeleteColumn !== null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen && action?.startsWith("delete-column:") !== true) {
              setDeleteColumnId(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("settings.columns.deleteTitle")}</DialogTitle>
              <DialogDescription>
                {selectedDeleteColumn
                  ? t("settings.columns.deleteNamedDescription", {
                    column: selectedDeleteColumn.title,
                  })
                  : t("settings.columns.deleteDescription")}
              </DialogDescription>
            </DialogHeader>

            {selectedDeleteColumn && !selectedDeleteColumnIsEmpty ? (
              <div className="space-y-4">
                {!board.settings.cardsEnabled ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    {t("settings.columns.enableCardsFirst")}
                  </p>
                ) : null}
                <div className="space-y-2">
                  <label htmlFor="delete-column-strategy" className="text-sm font-medium">
                    {t("settings.columns.strategyLabel")}
                  </label>
                  <select
                    id="delete-column-strategy"
                    className={selectClassName}
                    value={deleteStrategy}
                    disabled={busy || !board.settings.cardsEnabled}
                    onChange={(event) => {
                      const value = event.target.value;
                      setDeleteStrategy(
                        value === "moveCards" || value === "deleteCards" ? value : "",
                      );
                      setDeleteTargetColumnId("");
                      setDeleteCardsConfirmation("");
                    }}
                  >
                    <option value="">{t("settings.columns.chooseAction")}</option>
                    <option value="moveCards">{t("settings.columns.moveCards")}</option>
                    <option value="deleteCards">{t("settings.columns.deleteCards")}</option>
                  </select>
                </div>

                {deleteStrategy === "moveCards" ? (
                  <div className="space-y-2">
                    <label htmlFor="delete-column-target" className="text-sm font-medium">
                      {t("settings.columns.targetLabel")}
                    </label>
                    <select
                      id="delete-column-target"
                      className={selectClassName}
                      value={deleteTargetColumnId}
                      disabled={busy}
                      onChange={(event) => setDeleteTargetColumnId(event.target.value)}
                    >
                      <option value="">{t("settings.columns.chooseTarget")}</option>
                      {board.columns
                        .filter((candidate) => candidate.id !== selectedDeleteColumn.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.title}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.columns.moveLimitWarning")}
                    </p>
                  </div>
                ) : null}

                {deleteStrategy === "deleteCards" ? (
                  <div className="space-y-2">
                    <label htmlFor="delete-column-confirmation" className="text-sm font-medium text-destructive">
                      {t("settings.columns.deleteTokenPrompt", {
                        token: t("settings.columns.deleteToken"),
                      })}
                    </label>
                    <Input
                      id="delete-column-confirmation"
                      value={deleteCardsConfirmation}
                      disabled={busy}
                      autoComplete="off"
                      onChange={(event) => setDeleteCardsConfirmation(event.target.value)}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("settings.columns.emptyDescription")}
              </p>
            )}

            {sectionError("columns") ? (
              <p role="alert" className="text-sm text-destructive">
                {sectionError("columns")}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDeleteColumnId(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  busy
                  || (!selectedDeleteColumnIsEmpty && !board.settings.cardsEnabled)
                  || (!selectedDeleteColumnIsEmpty && deleteStrategy === "")
                  || (deleteStrategy === "moveCards" && !deleteTargetColumnId)
                  || (deleteStrategy === "deleteCards"
                    && deleteCardsConfirmation !== t("settings.columns.deleteToken"))
                }
                onClick={() => void deleteColumn()}
              >
                {action?.startsWith("delete-column:")
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Trash2 className="size-4" />}
                {t("settings.columns.deleteConfirmButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="reset-votes-heading">
      <div className="space-y-1">
        <h2 id="reset-votes-heading" className={sectionHeadingClassName}>
          {t("settings.danger.heading")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("settings.danger.description")}
        </p>
      </div>

      {sectionError("danger") && !resetOpen ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {sectionError("danger")}
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-4 border-b pb-5">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t("settings.danger.resetTitle")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.danger.resetDescription")}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={busy || !board.capabilities.canResetVotes}
          onClick={() => {
            setResetConfirmation("");
            setSectionError("danger", null);
            setResetOpen(true);
          }}
        >
          <RotateCcw className="size-4" />
          {t("settings.danger.resetButton")}
        </Button>
      </div>

      {!board.capabilities.canResetVotes ? (
        <p className="text-xs text-muted-foreground">
          {t("settings.danger.resetUnavailable")}
        </p>
      ) : null}

      <Dialog
        open={resetOpen}
        onOpenChange={(nextOpen) => {
          if (action !== "reset-votes") {
            setResetOpen(nextOpen);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.danger.confirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("settings.danger.confirmDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="reset-votes-confirmation" className="text-sm font-medium">
              {t("settings.danger.resetTokenPrompt", {
                token: t("settings.danger.resetToken"),
              })}
            </label>
            <Input
              id="reset-votes-confirmation"
              value={resetConfirmation}
              disabled={action === "reset-votes"}
              autoComplete="off"
              onChange={(event) => setResetConfirmation(event.target.value)}
            />
          </div>
          {sectionError("danger") ? (
            <p role="alert" className="text-sm text-destructive">
              {sectionError("danger")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={action === "reset-votes"}
              onClick={() => setResetOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                action === "reset-votes"
                || resetConfirmation !== t("settings.danger.resetToken")
              }
              onClick={() => void resetVotes()}
            >
              {action === "reset-votes"
                ? <Loader2 className="size-4 animate-spin" />
                : <RotateCcw className="size-4" />}
              {t("settings.danger.confirmButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

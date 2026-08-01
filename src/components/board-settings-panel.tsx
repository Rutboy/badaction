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

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
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
  fallback: string,
): Promise<unknown> => {
  let response: Response;

  try {
    response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`${fallback} Проверьте соединение.`);
  }

  const data = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  if (!response.ok) {
    throw new PanelRequestError(data?.error?.message ?? fallback, response.status);
  }

  return data;
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
  const [action, setAction] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<SettingsSection, string>>>({});
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

  const setSectionError = (target: SettingsSection, message: string | null) => {
    setErrors((current) => {
      if (message === null) {
        const next = { ...current };
        delete next[target];
        return next;
      }
      return { ...current, [target]: message };
    });
  };

  const runMutation = async <Result,>(
    target: SettingsSection,
    key: string,
    operation: () => Promise<Result>,
    successMessage: string,
  ): Promise<Result | null> => {
    setAction(key);
    setSectionError(target, null);

    try {
      const result = await operation();
      try {
        await onChanged();
      } catch {
        setSectionError(
          target,
          "Изменение сохранено, но обновить доску не удалось. Проверьте соединение.",
        );
        return result;
      }
      toast.success(successMessage);
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
        error instanceof Error ? error.message : "Не удалось выполнить действие.",
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
        "Не удалось сохранить настройки доски.",
      ),
      "Настройки доски сохранены",
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
        "Не удалось создать колонку.",
      ),
      "Колонка создана",
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
        "Не удалось сохранить колонку.",
      ),
      "Колонка обновлена",
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
        "Сначала включите и сохраните сбор карточек, чтобы обработать содержимое колонки.",
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
      if (deleteCardsConfirmation !== "УДАЛИТЬ") {
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
        "Не удалось удалить колонку.",
      ),
      "Колонка удалена",
    );

    if (result !== null) {
      setDeleteColumnId(null);
    }
  };

  const resetVotes = async () => {
    if (resetConfirmation !== "СБРОСИТЬ") {
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
        "Не удалось сбросить голоса.",
      ),
      "Все голоса сброшены",
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
            Основное
          </h2>
          <p className="text-sm text-muted-foreground">
            Название и режимы работы ретроспективы.
          </p>
        </div>

        {errors.general ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {errors.general}
          </p>
        ) : null}

        <form
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void saveBoardSettings();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="board-settings-title" className="text-sm font-medium">
              Название доски
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
                Введите от 1 до 120 символов.
              </p>
            ) : null}
          </div>

          <fieldset
            className="divide-y rounded-lg border"
            disabled={busy || !board.capabilities.canManageSettings}
          >
            <legend className="sr-only">Режимы доски</legend>
            <label className="flex cursor-pointer items-start gap-3 p-4 text-sm">
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={cardsEnabled}
                onChange={(event) => setCardsEnabled(event.target.checked)}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Сбор карточек</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Команда может добавлять и изменять доступные ей карточки.
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
                <span className="block font-medium">Голосование</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Участники могут ставить и снимать голоса в пределах лимита колонки.
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
                <span className="block font-medium">Только чтение</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Содержимое нельзя менять, но экспорт и управление доступом остаются доступны.
                </span>
              </span>
            </label>
          </fieldset>

          <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 border-t bg-background px-1 py-4">
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {boardSettingsChanged ? "Есть несохранённые изменения" : "Все изменения сохранены"}
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
              Сохранить настройки
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
              Колонки
            </h2>
            <p className="text-sm text-muted-foreground">
              Название и лимит голосов настраиваются отдельно.
            </p>
          </div>
          <Badge variant="outline">{board.columns.length}</Badge>
        </div>

        {errors.columns && selectedDeleteColumn === null ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {errors.columns}
          </p>
        ) : null}

        {!board.capabilities.canManageColumns ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
            Снимите режим «Только чтение» в разделе «Основное», чтобы изменить колонки.
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
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveColumn(column.id);
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
                    <div className="space-y-2">
                      <label htmlFor={`column-title-${column.id}`} className="text-xs font-medium text-muted-foreground">
                        Название
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
                        Голосов
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
                      Элементов: {column.totalCount}
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
                        Удалить
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
                        Сохранить
                      </Button>
                    </div>
                  </div>
                </form>
              </li>
            );
          })}
        </ul>

        <form
          className="space-y-4 rounded-lg border bg-secondary/35 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void createColumn();
          }}
        >
          <div>
            <h3 className="text-sm font-semibold">Новая колонка</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Она появится перед фиксированной колонкой «Решения».
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6.5rem]">
            <div className="space-y-2">
              <label htmlFor="new-column-title" className="text-xs font-medium text-muted-foreground">
                Название
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
                Голосов
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
            Добавить колонку
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
              <DialogTitle>Удалить колонку?</DialogTitle>
              <DialogDescription>
                {selectedDeleteColumn
                  ? `Колонка «${selectedDeleteColumn.title}» будет удалена.`
                  : "Колонка будет удалена."}
              </DialogDescription>
            </DialogHeader>

            {selectedDeleteColumn && !selectedDeleteColumnIsEmpty ? (
              <div className="space-y-4">
                {!board.settings.cardsEnabled ? (
                  <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                    Сначала включите и сохраните сбор карточек, чтобы обработать содержимое.
                  </p>
                ) : null}
                <div className="space-y-2">
                  <label htmlFor="delete-column-strategy" className="text-sm font-medium">
                    Что сделать с содержимым
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
                    <option value="">Выберите действие</option>
                    <option value="moveCards">Переместить в другую колонку</option>
                    <option value="deleteCards">Удалить вместе с карточками</option>
                  </select>
                </div>

                {deleteStrategy === "moveCards" ? (
                  <div className="space-y-2">
                    <label htmlFor="delete-column-target" className="text-sm font-medium">
                      Целевая колонка
                    </label>
                    <select
                      id="delete-column-target"
                      className={selectClassName}
                      value={deleteTargetColumnId}
                      disabled={busy}
                      onChange={(event) => setDeleteTargetColumnId(event.target.value)}
                    >
                      <option value="">Выберите колонку</option>
                      {board.columns
                        .filter((candidate) => candidate.id !== selectedDeleteColumn.id)
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.title}
                          </option>
                        ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      Перенос отменится, если голоса не помещаются в лимит целевой колонки.
                    </p>
                  </div>
                ) : null}

                {deleteStrategy === "deleteCards" ? (
                  <div className="space-y-2">
                    <label htmlFor="delete-column-confirmation" className="text-sm font-medium text-destructive">
                      Введите УДАЛИТЬ
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
                Колонка пуста. Это действие нельзя отменить.
              </p>
            )}

            {errors.columns ? (
              <p role="alert" className="text-sm text-destructive">
                {errors.columns}
              </p>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setDeleteColumnId(null)}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  busy
                  || (!selectedDeleteColumnIsEmpty && !board.settings.cardsEnabled)
                  || (!selectedDeleteColumnIsEmpty && deleteStrategy === "")
                  || (deleteStrategy === "moveCards" && !deleteTargetColumnId)
                  || (deleteStrategy === "deleteCards" && deleteCardsConfirmation !== "УДАЛИТЬ")
                }
                onClick={() => void deleteColumn()}
              >
                {action?.startsWith("delete-column:")
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Trash2 className="size-4" />}
                Удалить колонку
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
          Опасные действия
        </h2>
        <p className="text-sm text-muted-foreground">
          Эти изменения нельзя отменить.
        </p>
      </div>

      {errors.danger && !resetOpen ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {errors.danger}
        </p>
      ) : null}

      <div className="flex items-start justify-between gap-4 border-b pb-5">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Сбросить все голоса</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Удаляет голоса во всех feedback-колонках.
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
          Сбросить
        </Button>
      </div>

      {!board.capabilities.canResetVotes ? (
        <p className="text-xs text-muted-foreground">
          Сброс недоступен, пока включён режим «Только чтение».
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
            <DialogTitle>Сбросить все голоса?</DialogTitle>
            <DialogDescription>
              Голоса во всех колонках будут удалены без возможности восстановления.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="reset-votes-confirmation" className="text-sm font-medium">
              Введите СБРОСИТЬ для подтверждения
            </label>
            <Input
              id="reset-votes-confirmation"
              value={resetConfirmation}
              disabled={action === "reset-votes"}
              autoComplete="off"
              onChange={(event) => setResetConfirmation(event.target.value)}
            />
          </div>
          {errors.danger ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.danger}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={action === "reset-votes"}
              onClick={() => setResetOpen(false)}
            >
              Отмена
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={action === "reset-votes" || resetConfirmation !== "СБРОСИТЬ"}
              onClick={() => void resetVotes()}
            >
              {action === "reset-votes"
                ? <Loader2 className="size-4 animate-spin" />
                : <RotateCcw className="size-4" />}
              Сбросить голоса
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

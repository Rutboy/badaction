"use client";

import {
  CheckCircle2,
  Layers3,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { type RefObject, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readApiError } from "@/i18n/api-errors";
import { useI18n } from "@/i18n/provider";
import type {
  ActionItemView,
  CardView,
  GroupView,
} from "@/lib/services/content-types";
import { cn } from "@/lib/utils";

type OnChanged = () => unknown | Promise<unknown>;

class LocalizedRequestError extends Error {}

const getErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof LocalizedRequestError ? error.message : fallback;

const nullableText = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
};

const MutationError = ({ message }: { message: string | null }) =>
  message ? (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  ) : null;

const PendingLabel = ({ pending, children }: { pending: boolean; children: string }) => (
  <>
    {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
    {children}
  </>
);

const MenuTrigger = ({ label, disabled }: { label: string; disabled: boolean }) => (
  <DropdownMenuTrigger asChild>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 sm:size-8"
      aria-label={label}
      disabled={disabled}
    >
      <MoreHorizontal className="size-4" aria-hidden="true" />
    </Button>
  </DropdownMenuTrigger>
);

type ConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error: string | null;
  onConfirm: () => Promise<void>;
};

const ConfirmationDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
}: ConfirmationDialogProps) => {
  const { t } = useI18n();
  return (
    <Dialog
    open={open}
    onOpenChange={(nextOpen) => {
      if (!pending) onOpenChange(nextOpen);
    }}
  >
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <MutationError message={error} />
      <DialogFooter>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => onOpenChange(false)}
        >
          {t("content.common.cancel")}
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={pending}
          onClick={() => void onConfirm()}
        >
          <PendingLabel pending={pending}>
            {pending ? pendingLabel : confirmLabel}
          </PendingLabel>
        </Button>
      </DialogFooter>
    </DialogContent>
    </Dialog>
  );
};

export type CardMenuProps = {
  boardId: string;
  card: CardView;
  revision: string;
  canManageActionItems: boolean;
  disabled?: boolean;
  onChanged: OnChanged;
};

export const CardMenu = ({
  boardId,
  card,
  revision,
  canManageActionItems,
  disabled = false,
  onChanged,
}: CardMenuProps) => {
  const { locale, t } = useI18n();
  const textId = useId();
  const authorId = useId();
  const assigneeId = useId();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [text, setText] = useState(card.text);
  const [author, setAuthor] = useState(card.author ?? "");
  const [assignee, setAssignee] = useState("");
  const [pending, setPending] = useState<"edit" | "delete" | "action" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [locale]);

  if (!card.canEdit && !card.canDelete && !canManageActionItems) {
    return null;
  }

  const openEdit = () => {
    setText(card.text);
    setAuthor(card.author ?? "");
    setError(null);
    setEditOpen(true);
  };

  const updateCard = async () => {
    if (pending) return;
    if (!text.trim()) {
      setError(t("content.card.textRequired"));
      return;
    }

    setPending("edit");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          author: nullableText(author),
        }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.card.updateFailed"),
        );
      }

      await onChanged();
      setEditOpen(false);
      toast.success(t("content.card.updated"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.card.updateFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const deleteCard = async () => {
    if (pending) return;
    setPending("delete");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/cards/${card.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.card.deleteFailed"),
        );
      }

      await onChanged();
      setDeleteOpen(false);
      toast.success(t("content.card.deleted"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.card.deleteFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const createActionItem = async () => {
    if (pending) return;
    setPending("action");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "card",
          sourceCardId: card.id,
          assignee: nullableText(assignee),
        }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.action.createFailed"),
        );
      }

      await onChanged();
      setActionOpen(false);
      setAssignee("");
      toast.success(t("content.action.created"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.action.createFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const controlsDisabled = disabled || pending !== null;

  return (
    <>
      <DropdownMenu>
        <MenuTrigger label={t("content.card.actions")} disabled={controlsDisabled} />
        <DropdownMenuContent align="end">
          {card.canEdit ? (
            <DropdownMenuItem onSelect={openEdit} disabled={controlsDisabled}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("content.common.edit")}
            </DropdownMenuItem>
          ) : null}
          {canManageActionItems ? (
            <DropdownMenuItem
              disabled={controlsDisabled}
              onSelect={() => {
                setAssignee("");
                setError(null);
                setActionOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("content.card.createAction")}
            </DropdownMenuItem>
          ) : null}
          {card.canDelete ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={controlsDisabled}
                onSelect={() => {
                  setError(null);
                  setDeleteOpen(true);
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {t("content.common.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={editOpen}
        onOpenChange={(nextOpen) => {
          if (pending !== "edit") setEditOpen(nextOpen);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("content.card.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("content.card.editDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-4"
            aria-busy={pending === "edit"}
            onSubmit={(event) => {
              event.preventDefault();
              void updateCard();
            }}
          >
            <div className="space-y-2">
              <label htmlFor={textId} className="text-sm font-medium">
                {t("content.card.textLabel")}
              </label>
              <Textarea
                id={textId}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={1000}
                required
                autoFocus
                disabled={pending === "edit"}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={authorId} className="text-sm font-medium">
                {t("content.common.owner")}
              </label>
              <Input
                id={authorId}
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                maxLength={120}
                placeholder={t("content.common.optional")}
                disabled={pending === "edit"}
              />
            </div>
            <MutationError message={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditOpen(false)}
                disabled={pending === "edit"}
              >
                {t("content.common.cancel")}
              </Button>
              <Button type="submit" disabled={pending === "edit" || !text.trim()}>
                <PendingLabel pending={pending === "edit"}>
                  {pending === "edit"
                    ? t("content.common.saving")
                    : t("content.common.save")}
                </PendingLabel>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={actionOpen}
        onOpenChange={(nextOpen) => {
          if (pending !== "action") setActionOpen(nextOpen);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("content.card.createActionTitle")}</DialogTitle>
            <DialogDescription>
              {t("content.card.createActionDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-4"
            aria-busy={pending === "action"}
            onSubmit={(event) => {
              event.preventDefault();
              void createActionItem();
            }}
          >
            <div className="whitespace-pre-wrap break-words rounded-md border bg-muted p-3 text-sm leading-5">
              {card.text}
            </div>
            <div className="space-y-2">
              <label htmlFor={assigneeId} className="text-sm font-medium">
                {t("content.common.assignee")}
              </label>
              <Input
                id={assigneeId}
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                maxLength={120}
                placeholder={t("content.common.optional")}
                autoFocus
                disabled={pending === "action"}
              />
            </div>
            <MutationError message={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setActionOpen(false)}
                disabled={pending === "action"}
              >
                {t("content.common.cancel")}
              </Button>
              <Button type="submit" disabled={pending === "action"}>
                <PendingLabel pending={pending === "action"}>
                  {pending === "action"
                    ? t("content.common.adding")
                    : t("content.common.create")}
                </PendingLabel>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={(nextOpen) => {
          setDeleteOpen(nextOpen);
          if (nextOpen) setError(null);
        }}
        title={t("content.card.deleteTitle")}
        description={t("content.card.deleteDescription")}
        confirmLabel={t("content.common.delete")}
        pendingLabel={t("content.common.deleting")}
        pending={pending === "delete"}
        error={error}
        onConfirm={deleteCard}
      />
    </>
  );
};

export type GroupMenuProps = {
  boardId: string;
  group: GroupView;
  revision: string;
  disabled?: boolean;
  onChanged: OnChanged;
};

export const GroupMenu = ({
  boardId,
  group,
  revision,
  disabled = false,
  onChanged,
}: GroupMenuProps) => {
  const { locale, t } = useI18n();
  const titleId = useId();
  const primaryId = useId();
  const [editOpen, setEditOpen] = useState(false);
  const [ungroupOpen, setUngroupOpen] = useState(false);
  const [title, setTitle] = useState(group.title ?? "");
  const [primaryCardId, setPrimaryCardId] = useState(group.primaryCardId);
  const [pending, setPending] = useState<"edit" | "ungroup" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [locale]);

  if (!group.canUngroup) return null;

  const updateGroup = async () => {
    if (pending) return;
    setPending("edit");
    setError(null);
    try {
      const primaryChanged = primaryCardId !== group.primaryCardId;
      const payload: {
        title: string | null;
        primaryCardId?: string;
        expectedRevision?: string;
      } = { title: nullableText(title) };
      if (primaryChanged) {
        payload.primaryCardId = primaryCardId;
        payload.expectedRevision = revision;
      }
      const response = await fetch(`/api/boards/${boardId}/groups/${group.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.group.updateFailed"),
        );
      }

      await onChanged();
      setEditOpen(false);
      toast.success(t("content.group.updated"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.group.updateFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const ungroup = async () => {
    if (pending) return;
    setPending("ungroup");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/groups/${group.id}/ungroup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.group.ungroupFailed"),
        );
      }

      await onChanged();
      setUngroupOpen(false);
      toast.success(t("content.group.ungrouped"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.group.ungroupFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const controlsDisabled = disabled || pending !== null;

  return (
    <>
      <DropdownMenu>
        <MenuTrigger label={t("content.group.actions")} disabled={controlsDisabled} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={controlsDisabled}
            onSelect={() => {
              setTitle(group.title ?? "");
              setPrimaryCardId(group.primaryCardId);
              setError(null);
              setEditOpen(true);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
            {t("content.group.configure")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={controlsDisabled}
            onSelect={() => {
              setError(null);
              setUngroupOpen(true);
            }}
          >
            <Layers3 className="size-4" aria-hidden="true" />
            {t("content.group.ungroup")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={editOpen}
        onOpenChange={(nextOpen) => {
          if (pending !== "edit") setEditOpen(nextOpen);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("content.group.configureTitle")}</DialogTitle>
            <DialogDescription>
              {t("content.group.configureDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-4"
            aria-busy={pending === "edit"}
            onSubmit={(event) => {
              event.preventDefault();
              void updateGroup();
            }}
          >
            <div className="space-y-2">
              <label htmlFor={titleId} className="text-sm font-medium">
                {t("content.group.nameLabel")}
              </label>
              <Input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder={t("content.common.optional")}
                autoFocus
                disabled={pending === "edit"}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={primaryId} className="text-sm font-medium">
                {t("content.group.primaryCard")}
              </label>
              <select
                id={primaryId}
                value={primaryCardId}
                onChange={(event) => setPrimaryCardId(event.target.value)}
                disabled={pending === "edit"}
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
              >
                {group.cards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.text}
                  </option>
                ))}
              </select>
            </div>
            <MutationError message={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditOpen(false)}
                disabled={pending === "edit"}
              >
                {t("content.common.cancel")}
              </Button>
              <Button type="submit" disabled={pending === "edit"}>
                <PendingLabel pending={pending === "edit"}>
                  {pending === "edit"
                    ? t("content.common.saving")
                    : t("content.common.save")}
                </PendingLabel>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={ungroupOpen}
        onOpenChange={(nextOpen) => {
          setUngroupOpen(nextOpen);
          if (nextOpen) setError(null);
        }}
        title={t("content.group.ungroupTitle")}
        description={t("content.group.ungroupDescription")}
        confirmLabel={t("content.group.ungroup")}
        pendingLabel={t("content.group.ungrouping")}
        pending={pending === "ungroup"}
        error={error}
        onConfirm={ungroup}
      />
    </>
  );
};

export type GroupCardsDialogProps = {
  boardId: string;
  columnId: string;
  cards: CardView[];
  revision: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onChanged: OnChanged;
};

export const GroupCardsDialog = ({
  boardId,
  columnId,
  cards,
  revision,
  disabled = false,
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
  hideTrigger = false,
  returnFocusRef,
  onChanged,
}: GroupCardsDialogProps) => {
  const { formatNumber, locale, t } = useI18n();
  const titleId = useId();
  const primaryId = useId();
  const checkboxPrefix = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [primaryCardId, setPrimaryCardId] = useState("");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = controlledOpen ?? internalOpen;

  useEffect(() => setError(null), [locale]);

  const setOpen = (nextOpen: boolean) => {
    if (controlledOpen === undefined) {
      setInternalOpen(nextOpen);
    }
    onControlledOpenChange?.(nextOpen);
  };

  const resetForm = () => {
    setSelectedIds([]);
    setPrimaryCardId("");
    setTitle("");
    setError(null);
  };

  const toggleCard = (cardId: string, checked: boolean) => {
    if (checked && selectedIds.length >= 100) {
      setError(t("content.group.tooMany"));
      return;
    }
    const next = checked
      ? selectedIds.includes(cardId) ? selectedIds : [...selectedIds, cardId]
      : selectedIds.filter((id) => id !== cardId);
    setSelectedIds(next);
    setPrimaryCardId((currentPrimary) =>
      next.includes(currentPrimary) ? currentPrimary : (next[0] ?? ""));
    setError(null);
  };

  const createGroup = async () => {
    if (pending) return;
    if (selectedIds.length < 2 || selectedIds.length > 100) {
      setError(t("content.group.selectionRequired"));
      return;
    }
    if (!primaryCardId || !selectedIds.includes(primaryCardId)) {
      setError(t("content.group.primaryRequired"));
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columnId,
          cardIds: selectedIds,
          primaryCardId,
          title: nullableText(title),
          expectedRevision: revision,
        }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.group.createFailed"),
        );
      }

      await onChanged();
      setOpen(false);
      resetForm();
      toast.success(t("content.group.created"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.group.createFailed"));
      setError(message);
    } finally {
      setPending(false);
    }
  };

  const selectedCards = cards.filter((card) => selectedIds.includes(card.id));

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        setOpen(nextOpen);
        if (nextOpen) resetForm();
      }}
    >
      {!hideTrigger ? (
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground max-sm:size-11"
            aria-label={t("content.group.combine")}
            title={t("content.group.combine")}
            disabled={disabled || cards.length < 2}
          >
            <Layers3 className="size-4" aria-hidden="true" />
          </Button>
        </DialogTrigger>
      ) : null}
      <DialogContent
        className="flex max-h-[min(90dvh,44rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:p-0"
        onCloseAutoFocus={
          returnFocusRef
            ? (event) => {
                event.preventDefault();
                window.requestAnimationFrame(() =>
                  returnFocusRef.current?.focus(),
                );
              }
            : undefined
        }
      >
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>{t("content.group.combineTitle")}</DialogTitle>
          <DialogDescription>
            {t("content.group.combineDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            void createGroup();
          }}
        >
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
            <fieldset className="space-y-2" disabled={pending}>
              <legend className="text-sm font-medium">
                {t("content.group.cardsLabel")}
              </legend>
              <div className="max-h-64 divide-y overflow-y-auto rounded-md border bg-card">
                {cards.map((card) => {
                  const checked = selectedIds.includes(card.id);
                  const checkboxId = `${checkboxPrefix}-${card.id}`;
                  return (
                    <label
                      key={card.id}
                      htmlFor={checkboxId}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-3 py-3 text-sm transition-colors duration-150 hover:bg-muted",
                        checked && "bg-primary/5 hover:bg-primary/10",
                      )}
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => toggleCard(card.id, event.target.checked)}
                        disabled={!checked && selectedIds.length >= 100}
                        className="mt-0.5 size-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                      <span className="min-w-0">
                        <span className="block whitespace-pre-wrap break-words leading-5">{card.text}</span>
                        {card.author ? (
                          <span className="mt-1 block text-xs text-muted-foreground">{card.author}</span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="space-y-2">
              <label htmlFor={primaryId} className="text-sm font-medium">
                {t("content.group.primaryCard")}
              </label>
              <select
                id={primaryId}
                value={primaryCardId}
                onChange={(event) => setPrimaryCardId(event.target.value)}
                disabled={pending || selectedCards.length === 0}
                required
                className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none transition-[border-color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60"
              >
                <option value="">{t("content.common.selectCard")}</option>
                {selectedCards.map((card) => (
                  <option key={card.id} value={card.id}>
                    {card.text}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor={titleId} className="text-sm font-medium">
                {t("content.group.nameLabel")}
              </label>
              <Input
                id={titleId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder={t("content.common.optional")}
                disabled={pending}
              />
            </div>
          </div>
          <div className="sticky bottom-0 z-10 border-t bg-card p-4">
            <MutationError message={error} />
            <div className={cn("flex items-center justify-between gap-3", error && "mt-3")}>
              <p className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
                {t("content.common.selectedCount", {
                  count: selectedIds.length,
                  formattedCount: formatNumber(selectedIds.length),
                })}
              </p>
              <DialogFooter className="flex-row justify-end">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  {t("content.common.cancel")}
                </Button>
                <Button
                  type="submit"
                  disabled={pending || selectedIds.length < 2 || !primaryCardId}
                >
                  <PendingLabel pending={pending}>
                    {pending
                      ? t("content.group.combining")
                      : t("content.group.combine")}
                  </PendingLabel>
                </Button>
              </DialogFooter>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export type ActionItemMenuProps = {
  boardId: string;
  item: ActionItemView;
  revision: string;
  disabled?: boolean;
  onChanged: OnChanged;
};

export const ActionItemMenu = ({
  boardId,
  item,
  revision,
  disabled = false,
  onChanged,
}: ActionItemMenuProps) => {
  const { locale, t } = useI18n();
  const textId = useId();
  const assigneeId = useId();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [text, setText] = useState(item.text);
  const [assignee, setAssignee] = useState(item.assignee ?? "");
  const [pending, setPending] = useState<"edit" | "toggle" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setError(null), [locale]);

  const updateActionItem = async () => {
    if (pending) return;
    if (!text.trim()) {
      setError(t("content.action.textRequired"));
      return;
    }

    setPending("edit");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/action-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          assignee: nullableText(assignee),
        }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.action.updateFailed"),
        );
      }

      await onChanged();
      setEditOpen(false);
      toast.success(t("content.action.updated"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.action.updateFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const toggleCompleted = async () => {
    if (pending) return;
    setPending("toggle");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/action-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: !item.completed }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.action.statusFailed"),
        );
      }

      await onChanged();
      toast.success(
        item.completed
          ? t("content.action.reopened")
          : t("content.action.completed"),
      );
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.action.statusFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const deleteActionItem = async () => {
    if (pending) return;
    setPending("delete");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/action-items/${item.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedRevision: revision }),
      });
      if (!response.ok) {
        throw new LocalizedRequestError(
          await readApiError(response, t, "content.action.deleteFailed"),
        );
      }

      await onChanged();
      setDeleteOpen(false);
      toast.success(t("content.action.deleted"));
    } catch (caughtError) {
      const message = getErrorMessage(caughtError, t("content.action.deleteFailed"));
      setError(message);
    } finally {
      setPending(null);
    }
  };

  const controlsDisabled = disabled || pending !== null;

  return (
    <div className="flex flex-col items-end gap-1">
      <DropdownMenu>
        <MenuTrigger label={t("content.action.actions")} disabled={controlsDisabled} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={controlsDisabled}
            onSelect={() => {
              setText(item.text);
              setAssignee(item.assignee ?? "");
              setError(null);
              setEditOpen(true);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" />
            {t("content.common.edit")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={controlsDisabled} onSelect={() => void toggleCompleted()}>
            <CheckCircle2 className="size-4" aria-hidden="true" />
            {item.completed
              ? t("content.action.returnToWork")
              : t("content.action.markComplete")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={controlsDisabled}
            onSelect={() => {
              setError(null);
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            {t("content.common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {error && !editOpen && !deleteOpen ? (
        <p role="alert" className="max-w-64 text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Dialog
        open={editOpen}
        onOpenChange={(nextOpen) => {
          if (pending !== "edit") setEditOpen(nextOpen);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("content.action.editTitle")}</DialogTitle>
            <DialogDescription>
              {t("content.action.editDescription")}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            className="space-y-4"
            aria-busy={pending === "edit"}
            onSubmit={(event) => {
              event.preventDefault();
              void updateActionItem();
            }}
          >
            <div className="space-y-2">
              <label htmlFor={textId} className="text-sm font-medium">
                {t("content.action.actionLabel")}
              </label>
              <Textarea
                id={textId}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={1000}
                required
                autoFocus
                disabled={pending === "edit"}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={assigneeId} className="text-sm font-medium">
                {t("content.common.assignee")}
              </label>
              <Input
                id={assigneeId}
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
                maxLength={120}
                placeholder={t("content.common.optional")}
                disabled={pending === "edit"}
              />
            </div>
            <MutationError message={error} />
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditOpen(false)}
                disabled={pending === "edit"}
              >
                {t("content.common.cancel")}
              </Button>
              <Button type="submit" disabled={pending === "edit" || !text.trim()}>
                <PendingLabel pending={pending === "edit"}>
                  {pending === "edit"
                    ? t("content.common.saving")
                    : t("content.common.save")}
                </PendingLabel>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        open={deleteOpen}
        onOpenChange={(nextOpen) => {
          setDeleteOpen(nextOpen);
          if (nextOpen) setError(null);
        }}
        title={t("content.action.deleteTitle")}
        description={t("content.action.deleteDescription")}
        confirmLabel={t("content.common.delete")}
        pendingLabel={t("content.common.deleting")}
        pending={pending === "delete"}
        error={error}
        onConfirm={deleteActionItem}
      />
    </div>
  );
};

export {
  ActionItemCompletionControl,
  type ActionItemCompletionControlProps,
} from "@/components/board/action-item-completion-control";
export {
  ActionItemComposer,
  type ActionItemComposerProps,
} from "@/components/board/action-item-composer";

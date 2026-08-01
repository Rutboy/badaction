"use client";

import { Loader2, Plus, UserRound } from "lucide-react";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ApiErrorPayload = {
  error?: {
    message?: string;
  };
};

const readApiError = async (
  response: Response,
  fallback: string,
): Promise<string> => {
  const data = (await response
    .json()
    .catch(() => null)) as ApiErrorPayload | null;
  return data?.error?.message ?? fallback;
};

const nullableText = (value: string): string | null => {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
};

export type ActionItemComposerProps = {
  boardId: string;
  disabled?: boolean;
  onChanged: () => unknown | Promise<unknown>;
  className?: string;
};

export const ActionItemComposer = ({
  boardId,
  disabled = false,
  onChanged,
  className,
}: ActionItemComposerProps) => {
  const textId = useId();
  const assigneeId = useId();
  const errorId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const assigneeRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [showAssignee, setShowAssignee] = useState(false);
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setText("");
    setAssignee("");
    setShowAssignee(false);
    setError(null);
  };

  const close = () => {
    if (pending) return;
    reset();
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const createActionItem = async () => {
    if (pending || disabled) return;
    const normalizedText = text.trim();
    if (!normalizedText) {
      setError("Введите текст решения.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/action-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "manual",
          text: normalizedText,
          assignee: nullableText(assignee),
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Не удалось создать решение."),
        );
      }

      await onChanged();
      reset();
      setOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : "Не удалось создать решение.",
      );
    } finally {
      setPending(false);
    }
  };

  if (!open) {
    return (
      <div className={cn("w-full", className)}>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 w-full justify-start text-muted-foreground hover:text-foreground max-sm:h-11"
          disabled={disabled}
          onClick={() => {
            reset();
            setOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          Добавить решение
        </Button>
      </div>
    );
  }

  return (
    <form
      className={cn("space-y-3 rounded-lg border bg-card p-3", className)}
      aria-busy={pending}
      onSubmit={(event) => {
        event.preventDefault();
        void createActionItem();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void createActionItem();
        }
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={textId} className="text-sm font-medium">
          Новое решение
        </label>
        {text.length >= 900 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {text.length}/1000
          </span>
        ) : null}
      </div>
      <Textarea
        id={textId}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (error) setError(null);
        }}
        maxLength={1000}
        required
        autoFocus
        disabled={pending || disabled}
        placeholder="Что нужно сделать?"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className="min-h-20"
      />

      {showAssignee ? (
        <div className="space-y-2">
          <label
            htmlFor={assigneeId}
            className="text-xs font-medium text-muted-foreground"
          >
            Ответственный
          </label>
          <Input
            ref={assigneeRef}
            id={assigneeId}
            value={assignee}
            onChange={(event) => setAssignee(event.target.value)}
            maxLength={120}
            placeholder="Необязательно"
            disabled={pending || disabled}
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="-ml-2 text-muted-foreground"
          disabled={pending || disabled}
          onClick={() => {
            setShowAssignee(true);
            window.requestAnimationFrame(() => assigneeRef.current?.focus());
          }}
        >
          <UserRound className="size-4" aria-hidden="true" />
          Указать ответственного
        </Button>
      )}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={close}
        >
          Отмена
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending || disabled || !text.trim()}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {pending ? "Добавляем..." : "Добавить"}
        </Button>
      </div>
    </form>
  );
};

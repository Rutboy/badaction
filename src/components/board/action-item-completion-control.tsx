"use client";

import { Check, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionItemView } from "@/lib/services/content-types";
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

export type ActionItemCompletionControlProps = {
  boardId: string;
  item: ActionItemView;
  disabled?: boolean;
  onChanged: () => unknown | Promise<unknown>;
  className?: string;
};

export const ActionItemCompletionControl = ({
  boardId,
  item,
  disabled = false,
  onChanged,
  className,
}: ActionItemCompletionControlProps) => {
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleCompleted = async () => {
    if (pending || disabled) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/boards/${boardId}/action-items/${item.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ completed: !item.completed }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readApiError(response, "Не удалось изменить статус решения."),
        );
      }

      await onChanged();
    } catch (caughtError) {
      setError(
        caughtError instanceof Error && caughtError.message
          ? caughtError.message
          : "Не удалось изменить статус решения.",
      );
    } finally {
      setPending(false);
    }
  };

  const label = item.completed
    ? "Вернуть решение в работу"
    : "Отметить решение выполненным";

  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-1", className)}>
      <Button
        type="button"
        role="checkbox"
        aria-checked={item.completed}
        aria-label={label}
        aria-describedby={error ? errorId : undefined}
        aria-busy={pending}
        title={label}
        variant="ghost"
        size="icon"
        disabled={disabled || pending}
        onClick={() => void toggleCompleted()}
        className={cn(
          "size-11 shrink-0 rounded-md border p-0 sm:size-9",
          item.completed
            ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground"
            : "border-input bg-card text-transparent hover:bg-accent hover:text-transparent",
        )}
      >
        {pending ? (
          <Loader2
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        ) : (
          <Check className="size-4" aria-hidden="true" />
        )}
      </Button>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="max-w-52 text-xs leading-4 text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
};

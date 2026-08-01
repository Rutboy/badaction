"use client";

import { Loader2, Plus, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/i18n/provider";

export const CardComposer = ({
  columnId,
  columnTitle,
  pending,
  onCreate,
}: {
  columnId: string;
  columnTitle: string;
  pending: boolean;
  onCreate: (
    columnId: string,
    text: string,
    author: string | null,
  ) => Promise<{ ok: true } | { ok: false; message: string }>;
}) => {
  const { formatNumber, locale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [showAuthor, setShowAuthor] = useState(false);
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      textareaRef.current?.focus();
    }
  }, [open]);

  useEffect(() => setError(null), [locale]);

  const close = () => {
    if (pending) return;
    setOpen(false);
    setShowAuthor(false);
    setText("");
    setAuthor("");
    setError(null);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const submit = async () => {
    const normalizedText = text.trim();
    const normalizedAuthor = author.trim();
    if (!normalizedText) {
      setError(t("content.card.textRequired"));
      return;
    }
    if (normalizedText.length > 1000) {
      setError(t("content.card.textTooLong"));
      return;
    }

    setError(null);
    const result = await onCreate(
      columnId,
      normalizedText,
      normalizedAuthor || null,
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }

    setText("");
    setAuthor("");
    setShowAuthor(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  if (!open) {
    return (
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        className="h-10 w-full justify-start px-2 text-muted-foreground hover:text-foreground max-sm:h-11"
        onClick={() => setOpen(true)}
        aria-label={t("content.card.addToColumn", { column: columnTitle })}
      >
        <Plus className="size-4" aria-hidden="true" />
        {t("content.card.add")}
      </Button>
    );
  }

  return (
    <form
      noValidate
      className="space-y-2 border-b pb-3"
      aria-label={t("content.card.newInColumn", { column: columnTitle })}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
          return;
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          void submit();
        }
      }}
    >
      <label htmlFor={`new-card-text-${columnId}`} className="sr-only">
        {t("content.card.textLabel")}
      </label>
      <Textarea
        ref={textareaRef}
        id={`new-card-text-${columnId}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={pending}
        placeholder={t("content.card.placeholder")}
        maxLength={1000}
        required
        aria-describedby={
          error
            ? `new-card-error-${columnId}`
            : text.length >= 900
              ? `new-card-counter-${columnId}`
              : undefined
        }
        className="min-h-24 resize-y"
      />
      {showAuthor ? (
        <div className="flex items-center gap-2">
          <Input
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            disabled={pending}
            placeholder={t("content.card.authorPlaceholder")}
            maxLength={120}
            aria-label={t("content.card.authorInColumn", {
              column: columnTitle,
            })}
            autoFocus
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={t("content.card.removeAuthor")}
            disabled={pending}
            onClick={() => {
              setAuthor("");
              setShowAuthor(false);
              textareaRef.current?.focus();
            }}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="px-2 text-muted-foreground"
          disabled={pending}
          onClick={() => setShowAuthor(true)}
        >
          <UserRound className="size-4" aria-hidden="true" />
          {t("content.card.addAuthor")}
        </Button>
      )}
      {text.length >= 900 ? (
        <p
          id={`new-card-counter-${columnId}`}
          className="text-right text-xs text-muted-foreground"
        >
          {formatNumber(text.length)} / {formatNumber(1000)}
        </p>
      ) : null}
      {error ? (
        <p
          id={`new-card-error-${columnId}`}
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={close}
          disabled={pending}
        >
          {t("content.common.cancel")}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={pending || text.trim().length === 0}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : null}
          {t("content.common.add")}
        </Button>
      </div>
      <p className="sr-only">{t("content.common.keyboardSubmit")}</p>
    </form>
  );
};

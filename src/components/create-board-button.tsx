"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readApiError } from "@/i18n/api-errors";
import type { Locale } from "@/i18n/locales";
import { useI18n } from "@/i18n/provider";

type LocalizedError = {
  locale: Locale;
  message: string;
};

export const CreateBoardButton = () => {
  const router = useRouter();
  const { locale, t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LocalizedError | null>(null);
  const [title, setTitle] = useState("");
  const visibleError = error?.locale === locale ? error.message : null;

  const onCreate = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError({ locale, message: t("home.titleRequired") });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: normalizedTitle }),
      });

      if (!response.ok) {
        setError({
          locale,
          message: await readApiError(response, t, "home.createFailed"),
        });
        return;
      }

      const data = (await response.json().catch(() => null)) as { url?: unknown } | null;
      if (typeof data?.url !== "string" || data.url.length === 0) {
        setError({ locale, message: t("errors.invalidResponse") });
        return;
      }
      router.push(data.url);
    } catch {
      setError({ locale, message: t("home.createFailed") });
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate();
      }}
    >
      <label htmlFor="board-title" className="block text-sm font-medium">
        {t("home.boardTitleLabel")}
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="board-title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (visibleError) {
              setError(null);
            }
          }}
          placeholder={t("home.boardTitlePlaceholder")}
          maxLength={120}
          disabled={loading}
          autoFocus
          required
          aria-invalid={Boolean(visibleError)}
          aria-describedby={visibleError ? "board-title-error" : undefined}
          className="h-11 bg-card sm:flex-1"
        />
        <Button
          type="submit"
          size="lg"
          className="h-11 shrink-0 px-5"
          disabled={loading || title.trim().length === 0}
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {loading ? t("home.creating") : t("home.create")}
        </Button>
      </div>
      {visibleError ? (
        <p id="board-title-error" role="alert" className="text-sm text-destructive">
          {visibleError}
        </p>
      ) : null}
    </form>
  );
};

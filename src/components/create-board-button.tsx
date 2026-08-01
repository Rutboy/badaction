"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const CreateBoardButton = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  const onCreate = async () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Введите название ретроспективы.");
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
        const data = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(data?.error?.message ?? "Не удалось создать доску. Попробуйте ещё раз.");
        return;
      }

      const data = (await response.json()) as { url: string };
      router.push(data.url);
    } catch {
      setError("Не удалось создать доску. Попробуйте ещё раз.");
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
        Название ретроспективы
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="board-title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (error) {
              setError(null);
            }
          }}
          placeholder="Например, Ретро команды за июль"
          maxLength={120}
          disabled={loading}
          autoFocus
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "board-title-error" : undefined}
          className="h-11 bg-card sm:flex-1"
        />
        <Button
          type="submit"
          size="lg"
          className="h-11 shrink-0 px-5"
          disabled={loading || title.trim().length === 0}
        >
          {loading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {loading ? "Создаём..." : "Создать доску"}
        </Button>
      </div>
      {error ? (
        <p id="board-title-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
};

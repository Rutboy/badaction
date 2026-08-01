"use client";

import { Loader2, LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readApiError } from "@/i18n/api-errors";
import { useI18n } from "@/i18n/provider";

export const JoinBoardClient = () => {
  const router = useRouter();
  const { t } = useI18n();
  const invitationCaptured = useRef(false);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (invitationCaptured.current) {
      return;
    }
    invitationCaptured.current = true;

    const invitationToken = window.location.hash.slice(1);
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    if (!/^[A-Za-z0-9_-]{43}$/.test(invitationToken)) {
      setError(t("join.invalidInvitation"));
      return;
    }

    setToken(invitationToken);
  }, [t]);

  useEffect(() => {
    if (token) {
      displayNameRef.current?.focus();
    }
  }, [token]);

  const redeem = async () => {
    if (!token) {
      setError(t("join.invalidInvitation"));
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/invitations/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          displayName: displayName.trim() || undefined,
        }),
      });
      if (!response.ok) {
        setError(await readApiError(response, t, "join.redeemFailed"));
        return;
      }

      const data = (await response.json().catch(() => null)) as {
        boardId?: unknown;
      } | null;
      if (typeof data?.boardId !== "string" || data.boardId.length === 0) {
        setError(t("errors.invalidResponse"));
        return;
      }

      router.replace(`/boards/${data.boardId}`);
    } catch {
      setError(t("join.redeemNetworkFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-5 py-12 sm:px-8">
      <section aria-labelledby="join-title" className="w-full">
        <p className="mb-10 text-sm font-semibold tracking-tight text-primary">
          {t("common.productName")}
        </p>
        <h1 id="join-title" className="text-3xl font-semibold tracking-[-0.025em] sm:text-4xl">
          {t("join.title")}
        </h1>
        <p id="join-description" className="mt-4 text-sm leading-6 text-muted-foreground">
          {t("join.description")}
        </p>

        <form
          noValidate
          className="mt-8 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void redeem();
          }}
        >
          <label htmlFor="display-name" className="block text-sm font-medium">
            {t("join.nameLabel")}
          </label>
          <Input
            ref={displayNameRef}
            id="display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            maxLength={80}
            placeholder={t("join.namePlaceholder")}
            disabled={loading || !token}
            aria-describedby={error ? "join-error" : "join-description"}
            className="h-11 bg-card"
          />
          {error ? (
            <p id="join-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="h-11 w-full"
            disabled={loading || !token}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <LogIn className="size-4" aria-hidden="true" />
            )}
            {loading ? t("join.submitting") : t("join.submit")}
          </Button>
        </form>
      </section>
    </main>
  );
};

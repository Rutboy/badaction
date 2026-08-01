"use client";

import { Loader2, Plus } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";
import { toast } from "sonner";
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
import type {
  BoardRefreshOptions,
  BoardRefreshResult,
} from "@/components/use-board-realtime";
import { readApiError } from "@/i18n/api-errors";
import { useI18n } from "@/i18n/provider";
import type { BoardSnapshot } from "@/lib/pagination/board-state";

type ColumnMutationPayload = {
  revision?: unknown;
};

export const QuickColumnDialog = ({
  boardId,
  board,
  open,
  onOpenChange,
  onChanged,
  returnFocusRef,
}: {
  boardId: string;
  board: BoardSnapshot;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (options?: BoardRefreshOptions) => Promise<BoardRefreshResult>;
  returnFocusRef: RefObject<HTMLElement | null>;
}) => {
  const { locale, t } = useI18n();
  const [title, setTitle] = useState("");
  const [voteLimit, setVoteLimit] = useState("3");
  const [pending, setPending] = useState(false);
  const [createdAwaitingRefresh, setCreatedAwaitingRefresh] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    setTitle("");
    setVoteLimit("3");
    setCreatedAwaitingRefresh(false);
    setError(null);
  }, [open]);

  useEffect(() => setError(null), [locale]);

  const normalizedTitle = title.trim();
  const normalizedVoteLimitInput = voteLimit.trim();
  const normalizedVoteLimit = Number(voteLimit);
  const invalid =
    normalizedTitle.length < 1 ||
    normalizedTitle.length > 80 ||
    normalizedVoteLimitInput.length === 0 ||
    !Number.isInteger(normalizedVoteLimit) ||
    normalizedVoteLimit < 0 ||
    normalizedVoteLimit > 20;

  const createColumn = async () => {
    if (pending || invalid) {
      return;
    }

    const previousColumn = board.columns.at(-1) ?? null;
    let columnCreated = false;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: normalizedTitle,
          voteLimit: normalizedVoteLimit,
          placement: {
            beforeColumnId: previousColumn?.id ?? null,
            afterColumnId: null,
          },
          expectedRevision: board.revision,
        }),
      });
      if (!response.ok) {
        const message = await readApiError(
          response,
          t,
          "content.column.createFailed",
        );
        if (response.status === 409) {
          await onChanged().catch(() => undefined);
        }
        setError(message);
        return;
      }

      columnCreated = true;
      const payload = (await response
        .json()
        .catch(() => null)) as ColumnMutationPayload | null;
      const mutationRevision = payload?.revision;
      if (
        typeof mutationRevision !== "string" ||
        !/^(0|[1-9]\d*)$/.test(mutationRevision)
      ) {
        throw new Error("Column creation response did not include a revision");
      }

      const refreshResult = await onChanged({ force: true });
      if (
        refreshResult.status !== "ok" ||
        BigInt(refreshResult.revision) < BigInt(mutationRevision)
      ) {
        setCreatedAwaitingRefresh(true);
        setError(t("content.column.createdRefreshFailed"));
        return;
      }
      toast.success(t("content.column.added"));
      onOpenChange(false);
    } catch {
      if (columnCreated) {
        setCreatedAwaitingRefresh(true);
        setError(t("content.column.createdRefreshFailed"));
      } else {
        setError(t("content.column.createNetworkFailed"));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!pending) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent
        className="max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          window.requestAnimationFrame(() => returnFocusRef.current?.focus());
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("content.column.addTitle")}</DialogTitle>
          <DialogDescription>
            {t("content.column.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            void createColumn();
          }}
        >
          <div className="space-y-2">
            <label htmlFor="quick-column-title" className="text-sm font-medium">
              {t("content.common.title")}
            </label>
            <Input
              id="quick-column-title"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
              maxLength={80}
              autoFocus
              required
              disabled={pending || createdAwaitingRefresh}
              aria-invalid={
                title.length > 0 &&
                (normalizedTitle.length < 1 || normalizedTitle.length > 80)
              }
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="quick-column-vote-limit"
              className="text-sm font-medium"
            >
              {t("content.column.voteLimit")}
            </label>
            <Input
              id="quick-column-vote-limit"
              type="number"
              min={0}
              max={20}
              step={1}
              inputMode="numeric"
              required
              value={voteLimit}
              onChange={(event) => {
                setVoteLimit(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
              disabled={pending || createdAwaitingRefresh}
              aria-invalid={
                normalizedVoteLimitInput.length === 0 ||
                !Number.isInteger(normalizedVoteLimit) ||
                normalizedVoteLimit < 0 ||
                normalizedVoteLimit > 20
              }
              aria-describedby="quick-column-vote-limit-hint"
            />
            <p
              id="quick-column-vote-limit-hint"
              className="text-xs text-muted-foreground"
            >
              {t("content.column.voteLimitHint")}
            </p>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              {createdAwaitingRefresh
                ? t("content.common.close")
                : t("content.common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={pending || createdAwaitingRefresh || invalid}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              {pending ? t("content.common.adding") : t("content.column.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

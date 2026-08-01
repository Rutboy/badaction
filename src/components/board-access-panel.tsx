"use client";

import {
  Copy,
  KeyRound,
  Loader2,
  LogOut,
  Trash2,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
import { useI18n } from "@/i18n/provider";
import { MAX_PARTICIPANT_INVITATION_USES } from "@/lib/constants/access";

export type BoardViewer = {
  role: "OWNER" | "PARTICIPANT";
  displayName: string;
};

type Invitation = {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number;
  useCount: number;
  active: boolean;
};

type Participant = {
  id: string;
  displayName: string;
  createdAt: string;
};

type LocalizedError = {
  locale: Locale;
  message: string;
};

const sectionHeadingClassName = "text-base font-semibold tracking-tight";

export const BoardAccessContent = ({
  boardId,
  boardRevision,
  viewer,
  onChanged,
  section,
  active,
  disabled = false,
}: {
  boardId: string;
  boardRevision: string;
  viewer: BoardViewer;
  onChanged: () => Promise<unknown>;
  section: "access" | "danger";
  active: boolean;
  disabled?: boolean;
}) => {
  const router = useRouter();
  const { formatDate, formatNumber, locale, t } = useI18n();
  const i18nRef = useRef({ formatNumber, locale, t });
  const isOwner = viewer.role === "OWNER";
  const invitationInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<LocalizedError | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [freshInviteUrl, setFreshInviteUrl] = useState<string | null>(null);
  const [freshInviteMaxUses, setFreshInviteMaxUses] = useState<number | null>(null);
  const [invitationMaxUses, setInvitationMaxUses] = useState("1");
  const [revokeInvitationId, setRevokeInvitationId] = useState<string | null>(null);
  const [revokeParticipantId, setRevokeParticipantId] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [displayName, setDisplayName] = useState(viewer.displayName);
  const [displayNameError, setDisplayNameError] = useState<LocalizedError | null>(null);

  const visibleError = error?.locale === locale ? error.message : null;
  const visibleDisplayNameError = displayNameError?.locale === locale
    ? displayNameError.message
    : null;

  useEffect(() => {
    i18nRef.current = { formatNumber, locale, t };
  }, [formatNumber, locale, t]);

  const busy = disabled || action !== null;
  const parsedInvitationMaxUses = Number(invitationMaxUses);
  const invitationMaxUsesValid = Number.isInteger(parsedInvitationMaxUses)
    && parsedInvitationMaxUses >= 1
    && parsedInvitationMaxUses <= MAX_PARTICIPANT_INVITATION_USES;

  useEffect(() => {
    setDisplayName(viewer.displayName);
  }, [viewer.displayName]);

  const loadOwnerData = useCallback(async () => {
    if (!isOwner) {
      return;
    }

    const operationI18n = i18nRef.current;
    setLoading(true);
    setError(null);
    try {
      const [invitationsResponse, participantsResponse] = await Promise.all([
        fetch(`/api/boards/${boardId}/invitations`, { cache: "no-store" }),
        fetch(`/api/boards/${boardId}/members`, { cache: "no-store" }),
      ]);
      if (!invitationsResponse.ok || !participantsResponse.ok) {
        const failedResponse = !invitationsResponse.ok
          ? invitationsResponse
          : participantsResponse;
        setError({
          locale: operationI18n.locale,
          message: await readApiError(
            failedResponse,
            operationI18n.t,
            "access.errors.load",
          ),
        });
        return;
      }

      const invitationData = (await invitationsResponse.json()) as {
        invitations: Invitation[];
      };
      const participantData = (await participantsResponse.json()) as {
        participants: Participant[];
      };
      setInvitations(invitationData.invitations);
      setParticipants(participantData.participants);
    } catch {
      setError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.loadNetwork"),
      });
    } finally {
      setLoading(false);
    }
  }, [boardId, isOwner]);

  useEffect(() => {
    if (active && isOwner) {
      void loadOwnerData();
    }
  }, [active, boardRevision, isOwner, loadOwnerData]);

  useEffect(() => {
    if (freshInviteUrl) {
      invitationInputRef.current?.focus();
      invitationInputRef.current?.select();
    }
  }, [freshInviteUrl]);

  const createInvitation = async () => {
    const operationI18n = { locale, t };
    const maxUses = Number(invitationMaxUses);
    if (
      !Number.isInteger(maxUses)
      || maxUses < 1
      || maxUses > MAX_PARTICIPANT_INVITATION_USES
    ) {
      setError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.invalidMaxUses", {
          min: formatNumber(1),
          max: formatNumber(MAX_PARTICIPANT_INVITATION_USES),
        }),
      });
      return;
    }

    setAction("create-invitation");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxUses }),
      });
      if (!response.ok) {
        setError({
          locale: operationI18n.locale,
          message: await readApiError(
            response,
            operationI18n.t,
            "access.errors.createInvitation",
          ),
        });
        return;
      }
      const data = (await response.json().catch(() => null)) as {
        joinPath?: string;
      } | null;
      if (!data?.joinPath) {
        setError({
          locale: operationI18n.locale,
          message: operationI18n.t("errors.invalidResponse"),
        });
        return;
      }

      setFreshInviteUrl(new URL(data.joinPath, window.location.origin).toString());
      setFreshInviteMaxUses(maxUses);
      await loadOwnerData();
      toast.success(i18nRef.current.t("access.invitation.createdToast", {
        count: maxUses,
        formattedCount: i18nRef.current.formatNumber(maxUses),
      }));
    } catch {
      setError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.createInvitationNetwork"),
      });
    } finally {
      setAction(null);
    }
  };

  const copyInvitation = async () => {
    if (!freshInviteUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(freshInviteUrl);
      toast.success(i18nRef.current.t("access.invitation.copiedToast"));
    } catch {
      setError({ locale, message: t("access.errors.copy") });
    }
  };

  const revokeInvitation = async () => {
    if (!revokeInvitationId) {
      return;
    }

    const operationI18n = { locale, t };
    setAction(`revoke-invitation:${revokeInvitationId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/boards/${boardId}/invitations/${revokeInvitationId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError({
          locale: operationI18n.locale,
          message: await readApiError(
            response,
            operationI18n.t,
            "access.errors.revokeInvitation",
          ),
        });
        return;
      }
      setInvitations((current) => current.map((invitation) =>
        invitation.id === revokeInvitationId
          ? { ...invitation, active: false, revokedAt: new Date().toISOString() }
          : invitation));
      setFreshInviteUrl(null);
      setFreshInviteMaxUses(null);
      setRevokeInvitationId(null);
      toast.success(i18nRef.current.t("access.invitation.revokedToast"));
    } catch {
      setError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.revokeInvitationNetwork"),
      });
    } finally {
      setAction(null);
    }
  };

  const revokeParticipant = async () => {
    if (!revokeParticipantId) {
      return;
    }

    const operationI18n = { locale, t };
    setAction(`revoke-participant:${revokeParticipantId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/boards/${boardId}/members/${revokeParticipantId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError({
          locale: operationI18n.locale,
          message: await readApiError(
            response,
            operationI18n.t,
            "access.errors.revokeParticipant",
          ),
        });
        return;
      }
      setParticipants((current) => current.filter((participant) =>
        participant.id !== revokeParticipantId));
      setRevokeParticipantId(null);
      toast.success(i18nRef.current.t("access.participant.revokedToast"));
    } catch {
      setError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.revokeParticipantNetwork"),
      });
    } finally {
      setAction(null);
    }
  };

  const leave = async () => {
    const operationI18n = { locale, t };
    setAction("leave");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/membership`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError({
          locale: operationI18n.locale,
          message: await readApiError(response, operationI18n.t, "access.errors.leave"),
        });
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.leaveNetwork"),
      });
    } finally {
      setAction(null);
    }
  };

  const deleteBoard = async () => {
    if (deleteConfirmation !== t("access.danger.deleteToken")) {
      return;
    }

    const operationI18n = { locale, t };
    setAction("delete-board");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}`, { method: "DELETE" });
      if (!response.ok) {
        setError({
          locale: operationI18n.locale,
          message: await readApiError(
            response,
            operationI18n.t,
            "access.errors.deleteBoard",
          ),
        });
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.deleteBoardNetwork"),
      });
    } finally {
      setAction(null);
    }
  };

  const saveDisplayName = async () => {
    const operationI18n = { locale, t };
    const normalizedDisplayName = displayName.trim();
    if (!normalizedDisplayName || normalizedDisplayName.length > 80) {
      setDisplayNameError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.displayNameValidation"),
      });
      return;
    }
    if (normalizedDisplayName === viewer.displayName) {
      setDisplayName(normalizedDisplayName);
      setDisplayNameError(null);
      return;
    }

    setAction("rename-membership");
    setDisplayNameError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/membership`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: normalizedDisplayName }),
      });
      if (!response.ok) {
        setDisplayNameError({
          locale: operationI18n.locale,
          message: await readApiError(response, operationI18n.t, "access.errors.rename"),
        });
        return;
      }
      setDisplayName(normalizedDisplayName);
      await onChanged();
      toast.success(i18nRef.current.t("access.profile.savedToast"));
    } catch {
      setDisplayNameError({
        locale: operationI18n.locale,
        message: operationI18n.t("access.errors.renameNetwork"),
      });
    } finally {
      setAction(null);
    }
  };

  const profileSection = (
    <section className="space-y-3" aria-labelledby="membership-profile-heading">
      <div>
        <h3 id="membership-profile-heading" className="text-sm font-semibold">
          {t("access.profile.heading")}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("access.profile.description")}
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-start"
        onSubmit={(event) => {
          event.preventDefault();
          void saveDisplayName();
        }}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="membership-display-name" className="sr-only">
            {t("access.profile.inputLabel")}
          </label>
          <Input
            id="membership-display-name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setDisplayNameError(null);
            }}
            maxLength={80}
            autoComplete="name"
            disabled={busy}
            aria-invalid={Boolean(visibleDisplayNameError)}
            aria-describedby={visibleDisplayNameError
              ? "membership-display-name-error"
              : undefined}
          />
          {visibleDisplayNameError ? (
            <p id="membership-display-name-error" role="alert" className="text-sm text-destructive">
              {visibleDisplayNameError}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || displayName.trim() === viewer.displayName}
        >
          {action === "rename-membership" ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("access.profile.save")}
        </Button>
      </form>
    </section>
  );

  if (section === "danger") {
    if (!isOwner) {
      return null;
    }

    return (
      <section className="space-y-4" aria-labelledby="delete-board-heading">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 id="delete-board-heading" className="text-sm font-medium">
              {t("access.danger.heading")}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("access.danger.description")}
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              setDeleteConfirmation("");
              setError(null);
              setDeleteOpen(true);
            }}
          >
            <Trash2 className="size-4" />
            {t("access.danger.openButton")}
          </Button>
        </div>

        <Dialog
          open={deleteOpen}
          onOpenChange={(nextOpen) => {
            if (action !== "delete-board") {
              setDeleteOpen(nextOpen);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("access.danger.confirmTitle")}</DialogTitle>
              <DialogDescription>
                {t("access.danger.confirmDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label htmlFor="delete-board-confirmation" className="text-sm font-medium text-destructive">
                {t("access.danger.tokenPrompt", {
                  token: t("access.danger.deleteToken"),
                })}
              </label>
              <Input
                id="delete-board-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
                disabled={action === "delete-board"}
                aria-label={t("access.danger.confirmationLabel")}
              />
            </div>
            {visibleError
              ? <p role="alert" className="text-sm text-destructive">{visibleError}</p>
              : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={action === "delete-board"}
                onClick={() => setDeleteOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  action === "delete-board"
                  || deleteConfirmation !== t("access.danger.deleteToken")
                }
                onClick={() => void deleteBoard()}
              >
                {action === "delete-board"
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Trash2 className="size-4" />}
                {t("access.danger.confirmButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  if (!isOwner) {
    return (
      <section className="space-y-6" aria-labelledby="participation-heading">
        <div className="space-y-1">
          <h2 id="participation-heading" className={sectionHeadingClassName}>
            {t("access.participation.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("access.participation.current", { name: viewer.displayName })}
          </p>
        </div>

        {profileSection}

        {visibleError && !leaveOpen ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {visibleError}
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-4 border-t pt-5">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">{t("access.participation.leaveTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("access.participation.leaveDescription")}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setError(null);
              setLeaveOpen(true);
            }}
          >
            <LogOut className="size-4" />
            {t("access.participation.leaveOpenButton")}
          </Button>
        </div>

        <Dialog
          open={leaveOpen}
          onOpenChange={(nextOpen) => {
            if (action !== "leave") {
              setLeaveOpen(nextOpen);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("access.participation.confirmTitle")}</DialogTitle>
              <DialogDescription>
                {t("access.participation.confirmDescription")}
              </DialogDescription>
            </DialogHeader>
            {visibleError
              ? <p role="alert" className="text-sm text-destructive">{visibleError}</p>
              : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={action === "leave"}
                onClick={() => setLeaveOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={action === "leave"}
                onClick={() => void leave()}
              >
                {action === "leave"
                  ? <Loader2 className="size-4 animate-spin" />
                  : <LogOut className="size-4" />}
                {t("access.participation.confirmButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  return (
    <section className="space-y-7" aria-labelledby="invitation-heading">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 id="invitation-heading" className={sectionHeadingClassName}>
            {t("access.invitation.heading")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("access.invitation.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="invitation-max-uses" className="text-xs font-medium text-muted-foreground">
              {t("access.invitation.maxUsesLabel")}
            </label>
            <Input
              id="invitation-max-uses"
              className="w-28"
              type="number"
              min={1}
              max={MAX_PARTICIPANT_INVITATION_USES}
              step={1}
              inputMode="numeric"
              value={invitationMaxUses}
              disabled={busy}
              aria-invalid={!invitationMaxUsesValid}
              onChange={(event) => {
                setInvitationMaxUses(event.target.value);
                setError(null);
              }}
            />
          </div>
          <Button
            type="button"
            disabled={busy || !invitationMaxUsesValid}
            onClick={() => void createInvitation()}
          >
            {action === "create-invitation"
              ? <Loader2 className="size-4 animate-spin" />
              : <UserPlus className="size-4" />}
            {t("access.invitation.createLink")}
          </Button>
        </div>
      </div>

      {profileSection}

      {visibleError && revokeInvitationId === null && revokeParticipantId === null ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {visibleError}
        </p>
      ) : null}

      {freshInviteUrl ? (
        <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div>
            <label htmlFor="fresh-invite" className="text-sm font-medium">
              {t("access.invitation.freshLabel")}
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("access.invitation.freshDescription", {
                count: freshInviteMaxUses ?? 1,
                formattedCount: formatNumber(freshInviteMaxUses ?? 1),
              })}
            </p>
          </div>
          <Input
            ref={invitationInputRef}
            id="fresh-invite"
            readOnly
            value={freshInviteUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button type="button" onClick={() => void copyInvitation()}>
            <Copy className="size-4" />
            {t("access.invitation.copyButton")}
          </Button>
        </div>
      ) : null}

      <section className="space-y-3" aria-labelledby="active-invitations-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="active-invitations-heading" className="text-sm font-semibold">
            {t("access.invitation.listHeading")}
          </h3>
          <Badge
            variant="outline"
            aria-label={t("access.invitation.count", {
              count: invitations.length,
              formattedCount: formatNumber(invitations.length),
            })}
          >
            {formatNumber(invitations.length)}
          </Badge>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            {t("access.invitation.loading")}
          </div>
        ) : invitations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t("access.invitation.empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>
                      {t("access.invitation.createdAt", {
                        date: formatDate(invitation.createdAt, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                      })}
                    </span>
                    <Badge variant={invitation.active ? "outline" : "secondary"}>
                      {invitation.active
                        ? t("access.invitation.active")
                        : t("access.invitation.closed")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("access.invitation.usage", {
                      used: formatNumber(invitation.useCount),
                      total: formatNumber(invitation.maxUses),
                      date: formatDate(invitation.expiresAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })}
                  </p>
                </div>
                {invitation.active ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={t("access.invitation.revokeLabel")}
                    disabled={busy}
                    onClick={() => {
                      setError(null);
                      setRevokeInvitationId(invitation.id);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="participants-heading">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 id="participants-heading" className="text-sm font-semibold">
              {t("access.participant.heading")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("access.participant.description")}
            </p>
          </div>
          <Badge
            variant="outline"
            aria-label={t("access.participant.count", {
              count: participants.length,
              formattedCount: formatNumber(participants.length),
            })}
          >
            {formatNumber(participants.length)}
          </Badge>
        </div>
        {!loading && participants.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t("access.participant.empty")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {participants.map((participant) => (
              <li key={participant.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{participant.displayName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("access.participant.since", {
                      date: formatDate(participant.createdAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      }),
                    })}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("access.participant.revokeLabel", {
                    name: participant.displayName,
                  })}
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setRevokeParticipantId(participant.id);
                  }}
                >
                  <UserMinus className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={revokeInvitationId !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && action?.startsWith("revoke-invitation:") !== true) {
            setRevokeInvitationId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("access.invitation.revokeTitle")}</DialogTitle>
            <DialogDescription>
              {t("access.invitation.revokeDescription")}
            </DialogDescription>
          </DialogHeader>
          {visibleError
            ? <p role="alert" className="text-sm text-destructive">{visibleError}</p>
            : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setRevokeInvitationId(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void revokeInvitation()}>
              {action?.startsWith("revoke-invitation:")
                ? <Loader2 className="size-4 animate-spin" />
                : <Trash2 className="size-4" />}
              {t("access.invitation.revokeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeParticipantId !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && action?.startsWith("revoke-participant:") !== true) {
            setRevokeParticipantId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("access.participant.revokeTitle")}</DialogTitle>
            <DialogDescription>
              {t("access.participant.revokeDescription")}
            </DialogDescription>
          </DialogHeader>
          {visibleError
            ? <p role="alert" className="text-sm text-destructive">{visibleError}</p>
            : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setRevokeParticipantId(null)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void revokeParticipant()}>
              {action?.startsWith("revoke-participant:")
                ? <Loader2 className="size-4 animate-spin" />
                : <UserMinus className="size-4" />}
              {t("access.participant.revokeButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

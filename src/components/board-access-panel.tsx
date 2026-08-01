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

type ApiErrorPayload = {
  error?: { message?: string };
};

const readApiError = async (response: Response, fallback: string) => {
  const data = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  return data?.error?.message ?? fallback;
};

const formatDate = (value: string) => new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value));

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
  const isOwner = viewer.role === "OWNER";
  const invitationInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);

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
        setError(await readApiError(failedResponse, "Не удалось загрузить настройки доступа."));
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
      setError("Не удалось загрузить настройки доступа. Проверьте соединение.");
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
    const maxUses = Number(invitationMaxUses);
    if (
      !Number.isInteger(maxUses)
      || maxUses < 1
      || maxUses > MAX_PARTICIPANT_INVITATION_USES
    ) {
      setError(`Введите целое число от 1 до ${MAX_PARTICIPANT_INVITATION_USES}.`);
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
      const data = (await response.json().catch(() => null)) as {
        joinPath?: string;
        error?: { message?: string };
      } | null;
      if (!response.ok || !data?.joinPath) {
        setError(data?.error?.message ?? "Не удалось создать приглашение.");
        return;
      }

      setFreshInviteUrl(new URL(data.joinPath, window.location.origin).toString());
      setFreshInviteMaxUses(maxUses);
      await loadOwnerData();
      toast.success(maxUses === 1
        ? "Приглашение на один вход создано"
        : `Приглашение на ${maxUses} входов создано`);
    } catch {
      setError("Не удалось создать приглашение. Проверьте соединение.");
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
      toast.success("Ссылка скопирована");
    } catch {
      setError("Браузер не разрешил скопировать ссылку. Выделите её вручную.");
    }
  };

  const revokeInvitation = async () => {
    if (!revokeInvitationId) {
      return;
    }

    setAction(`revoke-invitation:${revokeInvitationId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/boards/${boardId}/invitations/${revokeInvitationId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await readApiError(response, "Не удалось отозвать приглашение."));
        return;
      }
      setInvitations((current) => current.map((invitation) =>
        invitation.id === revokeInvitationId
          ? { ...invitation, active: false, revokedAt: new Date().toISOString() }
          : invitation));
      setFreshInviteUrl(null);
      setFreshInviteMaxUses(null);
      setRevokeInvitationId(null);
      toast.success("Приглашение отозвано");
    } catch {
      setError("Не удалось отозвать приглашение. Проверьте соединение.");
    } finally {
      setAction(null);
    }
  };

  const revokeParticipant = async () => {
    if (!revokeParticipantId) {
      return;
    }

    setAction(`revoke-participant:${revokeParticipantId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/boards/${boardId}/members/${revokeParticipantId}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(await readApiError(response, "Не удалось отозвать доступ участника."));
        return;
      }
      setParticipants((current) => current.filter((participant) =>
        participant.id !== revokeParticipantId));
      setRevokeParticipantId(null);
      toast.success("Доступ участника отозван");
    } catch {
      setError("Не удалось отозвать доступ участника. Проверьте соединение.");
    } finally {
      setAction(null);
    }
  };

  const leave = async () => {
    setAction("leave");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}/membership`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await readApiError(response, "Не удалось покинуть доску."));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Не удалось покинуть доску. Проверьте соединение.");
    } finally {
      setAction(null);
    }
  };

  const deleteBoard = async () => {
    if (deleteConfirmation !== "УДАЛИТЬ") {
      return;
    }

    setAction("delete-board");
    setError(null);
    try {
      const response = await fetch(`/api/boards/${boardId}`, { method: "DELETE" });
      if (!response.ok) {
        setError(await readApiError(response, "Не удалось удалить доску."));
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError("Не удалось удалить доску. Проверьте соединение.");
    } finally {
      setAction(null);
    }
  };

  const saveDisplayName = async () => {
    const normalizedDisplayName = displayName.trim();
    if (!normalizedDisplayName || normalizedDisplayName.length > 80) {
      setDisplayNameError("Введите от 1 до 80 символов.");
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
        setDisplayNameError(await readApiError(response, "Не удалось изменить имя."));
        return;
      }
      setDisplayName(normalizedDisplayName);
      await onChanged();
      toast.success("Имя изменено");
    } catch {
      setDisplayNameError("Не удалось изменить имя. Проверьте соединение.");
    } finally {
      setAction(null);
    }
  };

  const profileSection = (
    <section className="space-y-3" aria-labelledby="membership-profile-heading">
      <div>
        <h3 id="membership-profile-heading" className="text-sm font-semibold">
          Ваше имя
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Оно отображается на этой доске и не связано с аккаунтом.
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
            Ваше имя на доске
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
            aria-invalid={Boolean(displayNameError)}
            aria-describedby={displayNameError ? "membership-display-name-error" : undefined}
          />
          {displayNameError ? (
            <p id="membership-display-name-error" role="alert" className="text-sm text-destructive">
              {displayNameError}
            </p>
          ) : null}
        </div>
        <Button
          type="submit"
          variant="outline"
          disabled={busy || displayName.trim() === viewer.displayName}
        >
          {action === "rename-membership" ? <Loader2 className="size-4 animate-spin" /> : null}
          Сохранить
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
              Удалить доску
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Карточки, голоса, решения, приглашения и доступы будут удалены.
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
            Удалить
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
              <DialogTitle>Удалить доску?</DialogTitle>
              <DialogDescription>
                Данные и все права доступа будут удалены без возможности восстановления.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <label htmlFor="delete-board-confirmation" className="text-sm font-medium text-destructive">
                Введите УДАЛИТЬ для подтверждения
              </label>
              <Input
                id="delete-board-confirmation"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
                disabled={action === "delete-board"}
                aria-label="Подтверждение удаления доски"
              />
            </div>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={action === "delete-board"}
                onClick={() => setDeleteOpen(false)}
              >
                Отмена
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={action === "delete-board" || deleteConfirmation !== "УДАЛИТЬ"}
                onClick={() => void deleteBoard()}
              >
                {action === "delete-board"
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Trash2 className="size-4" />}
                Удалить доску
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
            Участие
          </h2>
          <p className="text-sm text-muted-foreground">
            Вы участвуете как <span className="font-medium text-foreground">{viewer.displayName}</span>.
          </p>
        </div>

        {profileSection}

        {error && !leaveOpen ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex items-start justify-between gap-4 border-t pt-5">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">Покинуть доску</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Для повторного входа понадобится новое приглашение владельца.
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
            Выйти
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
              <DialogTitle>Покинуть доску?</DialogTitle>
              <DialogDescription>
                Текущая анонимная membership будет отозвана. UUID доски не вернёт доступ.
              </DialogDescription>
            </DialogHeader>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={action === "leave"}
                onClick={() => setLeaveOpen(false)}
              >
                Отмена
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
                Покинуть доску
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
            Доступ
          </h2>
          <p className="text-sm text-muted-foreground">
            Создайте одну ссылку для нужного количества участников.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <label htmlFor="invitation-max-uses" className="text-xs font-medium text-muted-foreground">
              Количество входов
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
            Создать ссылку
          </Button>
        </div>
      </div>

      {profileSection}

      {error && revokeInvitationId === null && revokeParticipantId === null ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {freshInviteUrl ? (
        <div className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div>
            <label htmlFor="fresh-invite" className="text-sm font-medium">
              Ссылка показывается только сейчас
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Доступно входов: {freshInviteMaxUses ?? 1}. Ссылку можно отозвать в любой момент.
              Любой получивший её сможет занять один из доступных входов.
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
            Скопировать
          </Button>
        </div>
      ) : null}

      <section className="space-y-3" aria-labelledby="active-invitations-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="active-invitations-heading" className="text-sm font-semibold">
            Приглашения
          </h3>
          <Badge variant="outline">{invitations.length}</Badge>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" />
            Загружаем доступы…
          </div>
        ) : invitations.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Приглашений пока нет.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0 space-y-1 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <KeyRound className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span>Создано {formatDate(invitation.createdAt)}</span>
                    <Badge variant={invitation.active ? "outline" : "secondary"}>
                      {invitation.active ? "Активно" : "Закрыто"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Использовано {invitation.useCount} из {invitation.maxUses}; до {formatDate(invitation.expiresAt)}
                  </p>
                </div>
                {invitation.active ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Отозвать приглашение"
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
              Участники
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Отозванный доступ закроется после ближайшей проверки.
            </p>
          </div>
          <Badge variant="outline">{participants.length}</Badge>
        </div>
        {!loading && participants.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Активных участников пока нет.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {participants.map((participant) => (
              <li key={participant.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{participant.displayName}</p>
                  <p className="mt-1 text-xs text-muted-foreground">С {formatDate(participant.createdAt)}</p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Отозвать доступ участника ${participant.displayName}`}
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
            <DialogTitle>Отозвать приглашение?</DialogTitle>
            <DialogDescription>
              Ссылка перестанет работать, если участник ещё не использовал её.
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setRevokeInvitationId(null)}>
              Отмена
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void revokeInvitation()}>
              {action?.startsWith("revoke-invitation:")
                ? <Loader2 className="size-4 animate-spin" />
                : <Trash2 className="size-4" />}
              Отозвать
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
            <DialogTitle>Отозвать доступ?</DialogTitle>
            <DialogDescription>
              Участник потеряет доступ к доске. Для возвращения понадобится новое приглашение.
            </DialogDescription>
          </DialogHeader>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="secondary" disabled={busy} onClick={() => setRevokeParticipantId(null)}>
              Отмена
            </Button>
            <Button type="button" variant="destructive" disabled={busy} onClick={() => void revokeParticipant()}>
              {action?.startsWith("revoke-participant:")
                ? <Loader2 className="size-4 animate-spin" />
                : <UserMinus className="size-4" />}
              Отозвать доступ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};

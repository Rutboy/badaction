"use client";

import {
  Columns3,
  Download,
  FileBraces,
  FileSpreadsheet,
  FileText,
  Info,
  Settings2,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { BoardAccessContent } from "@/components/board-access-panel";
import type { BoardManagementSection } from "@/components/board/board-management-types";
import { BoardSettingsContent } from "@/components/board-settings-panel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { BoardSnapshot } from "@/lib/pagination/board-state";
import { cn } from "@/lib/utils";

export type BoardManagementPanelProps = {
  boardId: string;
  board: BoardSnapshot;
  onChanged: () => Promise<unknown>;
  disabled?: boolean;
  open: boolean;
  activeSection: BoardManagementSection;
  focusedColumnId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSectionChange: (section: BoardManagementSection) => void;
};

type NavigationItem = {
  value: BoardManagementSection;
  label: string;
  icon: typeof Settings2;
};

const OWNER_NAVIGATION: readonly NavigationItem[] = [
  { value: "general", label: "Основное", icon: Settings2 },
  { value: "columns", label: "Колонки", icon: Columns3 },
  { value: "access", label: "Доступ", icon: Users },
  { value: "export", label: "Экспорт", icon: Download },
  { value: "about", label: "О доске", icon: Info },
  { value: "danger", label: "Опасные действия", icon: Trash2 },
];

const PARTICIPANT_NAVIGATION: readonly NavigationItem[] = [
  { value: "access", label: "Участие", icon: UserRound },
  { value: "export", label: "Экспорт", icon: Download },
  { value: "about", label: "О доске", icon: Info },
];

const formatExpirationDate = (value: string): string =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));

const ManagementNavigation = ({
  items,
  activeSection,
  onSectionChange,
  orientation,
}: {
  items: readonly NavigationItem[];
  activeSection: BoardManagementSection;
  onSectionChange: (section: BoardManagementSection) => void;
  orientation: "horizontal" | "vertical";
}) => (
  <nav
    aria-label="Разделы управления доской"
    className={cn(
      orientation === "horizontal"
        ? "flex gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        : "flex w-48 shrink-0 flex-col gap-1 border-r p-3",
    )}
  >
    {items.map(({ value, label, icon: Icon }) => (
      <Button
        key={value}
        type="button"
        size="sm"
        variant={activeSection === value ? "secondary" : "ghost"}
        aria-current={activeSection === value ? "page" : undefined}
        className={cn(
          "shrink-0",
          orientation === "vertical" && "w-full justify-start",
        )}
        onClick={() => onSectionChange(value)}
      >
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </Button>
    ))}
  </nav>
);

const ExportSection = ({ boardId }: { boardId: string }) => {
  const exports = [
    {
      label: "JSON",
      description: "Полная структура доски для обработки и резервной копии.",
      href: `/api/boards/${boardId}/export.json`,
      icon: FileBraces,
    },
    {
      label: "CSV",
      description: "Табличный формат для электронных таблиц.",
      href: `/api/boards/${boardId}/export.csv`,
      icon: FileSpreadsheet,
    },
    {
      label: "Markdown",
      description: "Читаемый текст для документов и заметок.",
      href: `/api/boards/${boardId}/export.md`,
      icon: FileText,
    },
  ] as const;

  return (
    <section className="space-y-6" aria-labelledby="board-export-heading">
      <div className="space-y-1">
        <h2
          id="board-export-heading"
          className="text-base font-semibold tracking-tight"
        >
          Экспорт
        </h2>
        <p className="text-sm text-muted-foreground">
          Выгрузка отражает актуальное состояние доски.
        </p>
      </div>
      <ul className="divide-y rounded-lg border">
        {exports.map(({ label, description, href, icon: Icon }) => (
          <li
            key={label}
            className="flex items-center justify-between gap-4 p-4"
          >
            <div className="flex min-w-0 items-start gap-3">
              <Icon
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
            <Button asChild variant="outline" size="sm">
              <a href={href} aria-label={`Экспорт ${label}`}>
                Скачать
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const AboutSection = ({ board }: { board: BoardSnapshot }) => (
  <section className="space-y-6" aria-labelledby="board-about-heading">
    <div className="space-y-1">
      <h2
        id="board-about-heading"
        className="text-base font-semibold tracking-tight"
      >
        О доске
      </h2>
      <p className="text-sm text-muted-foreground">
        Доступ и срок хранения этой ретроспективы.
      </p>
    </div>
    <dl className="divide-y rounded-lg border text-sm">
      <div className="grid gap-1 p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Название</dt>
        <dd className="break-words font-medium">{board.title}</dd>
      </div>
      <div className="grid gap-1 p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Ваш доступ</dt>
        <dd>
          {board.viewer.displayName} ·{" "}
          {board.viewer.role === "OWNER" ? "Владелец" : "Участник"}
        </dd>
      </div>
      <div className="grid gap-1 p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <dt className="text-muted-foreground">Данные хранятся до</dt>
        <dd>
          <time dateTime={board.expiresAt}>
            {formatExpirationDate(board.expiresAt)}
          </time>
        </dd>
      </div>
    </dl>
    <div className="space-y-2 text-sm leading-6 text-muted-foreground">
      <p>
        Аккаунты не используются. Доступ привязан к анонимной сессии этого
        браузера.
      </p>
      <p>
        Очистка данных браузера приведёт к потере текущего доступа. Участнику
        понадобится новое приглашение.
      </p>
    </div>
  </section>
);

export const BoardManagementPanel = ({
  boardId,
  board,
  onChanged,
  disabled = false,
  open,
  activeSection,
  focusedColumnId = null,
  onOpenChange,
  onSectionChange,
}: BoardManagementPanelProps) => {
  const openerRef = useRef<HTMLElement | null>(null);
  const lastExternalFocusRef = useRef<HTMLElement | null>(null);
  const owner = board.viewer.role === "OWNER";
  const navigation = owner ? OWNER_NAVIGATION : PARTICIPANT_NAVIGATION;
  const resolvedSection = useMemo(
    () =>
      navigation.some((item) => item.value === activeSection)
        ? activeSection
        : navigation[0].value,
    [activeSection, navigation],
  );
  const settingsSection =
    resolvedSection === "columns" || resolvedSection === "danger"
      ? resolvedSection
      : "general";
  const settingsActive =
    owner &&
    (resolvedSection === "general" ||
      resolvedSection === "columns" ||
      resolvedSection === "danger");

  useEffect(() => {
    if (resolvedSection !== activeSection) {
      onSectionChange(resolvedSection);
    }
  }, [activeSection, onSectionChange, resolvedSection]);

  useEffect(() => {
    if (open) {
      return;
    }

    const rememberExternalTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement) || target.closest('[role="menu"]')) {
        return;
      }

      const focusTarget = target.closest<HTMLElement>(
        'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusTarget) {
        lastExternalFocusRef.current = focusTarget;
      }
    };
    const handleFocusIn = (event: FocusEvent) => {
      rememberExternalTarget(event.target);
    };
    const handlePointerDown = (event: PointerEvent) => {
      rememberExternalTarget(event.target);
    };

    rememberExternalTarget(document.activeElement);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="board-management-panel"
        className="inset-0 flex h-[100dvh] max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 shadow-xl sm:inset-y-0 sm:right-0 sm:left-auto sm:w-[min(94vw,48rem)] sm:rounded-l-xl sm:border sm:border-r-0"
        closeClassName="top-[calc(0.75rem+env(safe-area-inset-top))] right-[calc(0.75rem+env(safe-area-inset-right))]"
        onOpenAutoFocus={() => {
          const activeElement = document.activeElement;
          const activeOutsideMenu =
            activeElement instanceof HTMLElement &&
            activeElement !== document.body &&
            !activeElement.closest('[role="menu"]')
              ? activeElement
              : null;
          const opener = activeOutsideMenu ?? lastExternalFocusRef.current;
          openerRef.current = opener?.isConnected ? opener : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const opener = openerRef.current;
          openerRef.current = null;
          window.requestAnimationFrame(() => {
            if (opener?.isConnected) {
              opener.focus();
            }
          });
        }}
      >
        <DialogHeader className="shrink-0 border-b pt-[calc(1rem+env(safe-area-inset-top))] pr-[calc(4.25rem+env(safe-area-inset-right))] pb-4 pl-[calc(1rem+env(safe-area-inset-left))] sm:pt-[calc(1.25rem+env(safe-area-inset-top))] sm:pb-5 sm:pl-[calc(1.5rem+env(safe-area-inset-left))]">
          <div className="flex items-center gap-2">
            {owner ? (
              <ShieldCheck
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            ) : (
              <UserRound
                className="size-4 text-muted-foreground"
                aria-hidden="true"
              />
            )}
            <DialogTitle>Управление доской</DialogTitle>
          </div>
          <DialogDescription>
            {owner
              ? "Настройки, доступ, экспорт и срок хранения в одном месте."
              : "Ваш доступ, экспорт и информация о хранении."}
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 border-b pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:hidden">
          <ManagementNavigation
            items={navigation}
            activeSection={resolvedSection}
            onSectionChange={onSectionChange}
            orientation="horizontal"
          />
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="hidden md:block">
            <ManagementNavigation
              items={navigation}
              activeSection={resolvedSection}
              onSectionChange={onSectionChange}
              orientation="vertical"
            />
          </div>
          <div className="min-w-0 flex-1 overflow-y-auto overscroll-contain pt-6 pr-[calc(1rem+env(safe-area-inset-right))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] pl-[calc(1rem+env(safe-area-inset-left))] sm:pr-[calc(1.5rem+env(safe-area-inset-right))] sm:pl-[calc(1.5rem+env(safe-area-inset-left))]">
            {owner ? (
              <div hidden={!settingsActive} className="space-y-7">
                <BoardSettingsContent
                  boardId={boardId}
                  board={board}
                  onChanged={onChanged}
                  section={settingsSection}
                  open={open}
                  focusedColumnId={focusedColumnId}
                  disabled={disabled}
                />
                {resolvedSection === "danger" ? (
                  <div className="border-t pt-6">
                    <BoardAccessContent
                      boardId={boardId}
                      boardRevision={board.revision}
                      viewer={board.viewer}
                      onChanged={onChanged}
                      section="danger"
                      active={false}
                      disabled={disabled}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}

            <div hidden={resolvedSection !== "access"}>
              <BoardAccessContent
                boardId={boardId}
                boardRevision={board.revision}
                viewer={board.viewer}
                onChanged={onChanged}
                section="access"
                active={open && resolvedSection === "access"}
                disabled={disabled}
              />
            </div>

            <div hidden={resolvedSection !== "export"}>
              <ExportSection boardId={boardId} />
            </div>

            <div hidden={resolvedSection !== "about"}>
              <AboutSection board={board} />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

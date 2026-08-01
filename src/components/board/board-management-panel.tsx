"use client";

import {
  Columns3,
  Download,
  FileBraces,
  FileSpreadsheet,
  FileText,
  Info,
  Languages,
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
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { MessageKey } from "@/i18n/messages";
import { useI18n } from "@/i18n/provider";
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
  labelKey: MessageKey;
  icon: typeof Settings2;
};

const OWNER_NAVIGATION: readonly NavigationItem[] = [
  {
    value: "general",
    labelKey: "boardShell.management.sections.general",
    icon: Settings2,
  },
  {
    value: "interface",
    labelKey: "boardShell.management.sections.interface",
    icon: Languages,
  },
  {
    value: "columns",
    labelKey: "boardShell.management.sections.columns",
    icon: Columns3,
  },
  {
    value: "access",
    labelKey: "boardShell.management.sections.access",
    icon: Users,
  },
  {
    value: "export",
    labelKey: "boardShell.management.sections.export",
    icon: Download,
  },
  {
    value: "about",
    labelKey: "boardShell.management.sections.about",
    icon: Info,
  },
  {
    value: "danger",
    labelKey: "boardShell.management.sections.danger",
    icon: Trash2,
  },
];

const PARTICIPANT_NAVIGATION: readonly NavigationItem[] = [
  {
    value: "interface",
    labelKey: "boardShell.management.sections.interface",
    icon: Languages,
  },
  {
    value: "access",
    labelKey: "boardShell.management.sections.participation",
    icon: UserRound,
  },
  {
    value: "export",
    labelKey: "boardShell.management.sections.export",
    icon: Download,
  },
  {
    value: "about",
    labelKey: "boardShell.management.sections.about",
    icon: Info,
  },
];

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
}) => {
  const { t } = useI18n();

  return (
    <nav
      aria-label={t("boardShell.management.navigationLabel")}
      className={cn(
        orientation === "horizontal"
          ? "flex gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : "flex w-48 shrink-0 flex-col gap-1 border-r p-3",
      )}
    >
      {items.map(({ value, labelKey, icon: Icon }) => (
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
          {t(labelKey)}
        </Button>
      ))}
    </nav>
  );
};

const ExportSection = ({ boardId }: { boardId: string }) => {
  const { t } = useI18n();
  const exports = [
    {
      label: "JSON",
      description: t("boardShell.management.export.jsonDescription"),
      href: `/api/boards/${boardId}/export.json`,
      icon: FileBraces,
    },
    {
      label: "CSV",
      description: t("boardShell.management.export.csvDescription"),
      href: `/api/boards/${boardId}/export.csv`,
      icon: FileSpreadsheet,
    },
    {
      label: "Markdown",
      description: t("boardShell.management.export.markdownDescription"),
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
          {t("boardShell.management.export.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("boardShell.management.export.description")}
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
              <a
                href={href}
                aria-label={t("boardShell.management.export.downloadLabel", {
                  format: label,
                })}
              >
                {t("boardShell.management.export.download")}
              </a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};

const InterfaceSection = () => {
  const { t } = useI18n();

  return (
    <section className="space-y-6" aria-labelledby="board-interface-heading">
      <div className="space-y-1">
        <h2
          id="board-interface-heading"
          className="text-base font-semibold tracking-tight"
        >
          {t("boardShell.management.interface.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("boardShell.management.interface.description")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-4 border-y py-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {t("boardShell.management.interface.languageLabel")}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {t("boardShell.management.interface.personal")}
          </p>
        </div>
        <LanguageSwitcher className="border" />
      </div>
    </section>
  );
};

const AboutSection = ({ board }: { board: BoardSnapshot }) => {
  const { formatDate, t } = useI18n();

  return (
    <section className="space-y-6" aria-labelledby="board-about-heading">
      <div className="space-y-1">
        <h2
          id="board-about-heading"
          className="text-base font-semibold tracking-tight"
        >
          {t("boardShell.management.about.title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("boardShell.management.about.description")}
        </p>
      </div>
      <dl className="divide-y rounded-lg border text-sm">
        <div className="grid gap-1 p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">
            {t("boardShell.management.about.name")}
          </dt>
          <dd className="break-words font-medium">{board.title}</dd>
        </div>
        <div className="grid gap-1 p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">
            {t("boardShell.management.about.access")}
          </dt>
          <dd>
            {board.viewer.displayName} ·{" "}
            {board.viewer.role === "OWNER"
              ? t("boardShell.management.about.owner")
              : t("boardShell.management.about.participant")}
          </dd>
        </div>
        <div className="grid gap-1 p-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <dt className="text-muted-foreground">
            {t("boardShell.management.about.expiresAt")}
          </dt>
          <dd>
            <time dateTime={board.expiresAt}>
              {formatDate(board.expiresAt, {
                dateStyle: "long",
                timeZone: "UTC",
              })}
            </time>
          </dd>
        </div>
      </dl>
      <div className="space-y-2 text-sm leading-6 text-muted-foreground">
        <p>{t("boardShell.management.about.sessionDescription")}</p>
        <p>{t("boardShell.management.about.clearingData")}</p>
      </div>
    </section>
  );
};

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
  const { t } = useI18n();
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
            <DialogTitle>{t("boardShell.management.title")}</DialogTitle>
          </div>
          <DialogDescription>
            {owner
              ? t("boardShell.management.ownerDescription")
              : t("boardShell.management.participantDescription")}
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

            <div hidden={resolvedSection !== "interface"}>
              <InterfaceSection />
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

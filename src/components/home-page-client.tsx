"use client";

import { CalendarClock, Crown, UserRound } from "lucide-react";
import Link from "next/link";
import { CreateBoardButton } from "@/components/create-board-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ProductLogo } from "@/components/product-logo";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useI18n } from "@/i18n/provider";
import type { AccessibleBoardSummary } from "@/lib/access/session-service";

export const HomePageClient = ({
  boards,
}: {
  boards: readonly AccessibleBoardSummary[];
}) => {
  const { formatDate, t } = useI18n();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl items-center px-5 py-12 sm:px-8">
      <section aria-labelledby="home-title" className="w-full">
        <div className="mb-10 flex min-w-0 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3 text-sm font-semibold tracking-tight text-primary">
            <ProductLogo />
            <span>{t("common.productName")}</span>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="max-w-2xl">
          <h1
            id="home-title"
            className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.035em] sm:text-5xl"
          >
            {t("home.title")}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">
            {t("home.description")}
          </p>
        </div>

        <div className="mt-9 max-w-lg">
          <CreateBoardButton />
          <p className="mt-4 text-sm leading-5 text-muted-foreground">
            {t("home.privacy")}
          </p>
        </div>

        {boards.length > 0 ? (
          <section aria-labelledby="accessible-boards-title" className="mt-12">
            <div>
              <h2
                id="accessible-boards-title"
                className="text-xl font-semibold"
              >
                {t("home.accessibleBoards")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("home.accessibleBoardsDescription")}
              </p>
            </div>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {boards.map((board) => (
                <li key={board.id}>
                  <Card className="h-full transition-colors hover:border-primary/30 hover:bg-secondary/20">
                    <Link
                      href={`/boards/${board.id}`}
                      className="flex h-full min-h-32 flex-col p-5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      aria-label={t("home.openBoard", { title: board.title })}
                      title={t("home.openBoard", { title: board.title })}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <h3 className="min-w-0 break-words text-base font-semibold [overflow-wrap:anywhere]">
                          {board.title}
                        </h3>
                        <Badge variant="secondary" className="shrink-0 gap-1">
                          {board.role === "OWNER" ? (
                            <Crown className="size-3" aria-hidden="true" />
                          ) : (
                            <UserRound className="size-3" aria-hidden="true" />
                          )}
                          {board.role === "OWNER"
                            ? t("home.ownerRole")
                            : t("home.participantRole")}
                        </Badge>
                      </div>
                      <p className="mt-auto flex items-center gap-1.5 pt-5 text-xs text-muted-foreground">
                        <CalendarClock
                          className="size-3.5"
                          aria-hidden="true"
                        />
                        {t("home.expiresAt", {
                          date: formatDate(board.expiresAt, {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          }),
                        })}
                      </p>
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
};

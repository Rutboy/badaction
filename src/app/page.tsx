"use client";

import { CreateBoardButton } from "@/components/create-board-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n } from "@/i18n/provider";

export default function HomePage() {
  const { t } = useI18n();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl items-center px-5 py-12 sm:px-8">
      <section aria-labelledby="home-title" className="w-full">
        <div className="mb-10 flex min-w-0 items-center justify-between gap-4">
          <p className="min-w-0 text-sm font-semibold tracking-tight text-primary">
            {t("common.productName")}
          </p>
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
      </section>
    </main>
  );
}

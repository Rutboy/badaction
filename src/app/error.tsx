"use client";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/provider";

export default function ErrorBoundary({ reset }: { reset: () => void }) {
  const { t } = useI18n();

  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl items-center px-5 py-12 sm:px-8">
      <section
        className="w-full border-l-2 border-destructive pl-5"
        aria-labelledby="route-error-title"
      >
        <h1 id="route-error-title" className="text-2xl font-semibold">
          {t("errorBoundary.title")}
        </h1>
        <p
          role="alert"
          className="mt-4 text-sm leading-6 text-muted-foreground"
        >
          {t("errorBoundary.description")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-6"
          onClick={reset}
        >
          {t("errorBoundary.retry")}
        </Button>
      </section>
    </main>
  );
}

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getServerI18n } from "@/i18n/server";

export default async function BoardNotFound() {
  const { t } = await getServerI18n();

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section
        className="max-w-md text-center"
        aria-labelledby="board-not-found-title"
      >
        <h1 id="board-not-found-title" className="text-2xl font-semibold">
          {t("notFound.boardUnavailable")}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {t("notFound.boardDescription")}
        </p>
        <Button asChild className="mt-6">
          <Link href="/">{t("common.backHome")}</Link>
        </Button>
      </section>
    </main>
  );
}

import { getServerI18n } from "@/i18n/server";

export default async function NotFound() {
  const { t } = await getServerI18n();

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <p className="text-lg text-slate-700">{t("notFound.page")}</p>
    </main>
  );
}

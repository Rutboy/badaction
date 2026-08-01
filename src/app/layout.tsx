import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { I18nProvider } from "@/i18n/provider";
import { getRequestLocale, getServerI18n } from "@/i18n/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t("metadata.title"),
    description: t("metadata.description"),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#f7f7f5",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <I18nProvider initialLocale={locale}>
          {children}
          <Toaster position="top-right" />
        </I18nProvider>
      </body>
    </html>
  );
}

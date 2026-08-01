import type { Metadata } from "next";
import { JoinBoardClient } from "@/components/join-board-client";
import { getServerI18n } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerI18n();
  return {
    title: t("metadata.joinTitle"),
    robots: {
      index: false,
      follow: false,
      noarchive: true,
      nosnippet: true,
    },
  };
}

export default function JoinPage() {
  return <JoinBoardClient />;
}

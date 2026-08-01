import type { Metadata } from "next";
import { JoinBoardClient } from "@/components/join-board-client";

export const metadata: Metadata = {
  title: "Войти на доску",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
  },
};

export default function JoinPage() {
  return <JoinBoardClient />;
}


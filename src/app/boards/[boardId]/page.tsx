import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BoardPageClient } from "@/components/board-page-client";
import { getExistingVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError } from "@/lib/errors/api-error";
import { DATABASE_UNAVAILABLE_CODE, normalizePrismaError } from "@/lib/errors/prisma";
import {
  deriveContentVisitorIdentity,
  getTargetBoardSnapshot,
} from "@/lib/services/target-content-service";
import { uuidParamSchema } from "@/lib/validators/common";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nosnippet: true,
  },
};

export default async function BoardPage({ params }: { params: Promise<{ boardId: string }> }) {
  const { boardId } = await params;
  const parsedBoardId = uuidParamSchema.safeParse(boardId);

  if (!parsedBoardId.success) {
    notFound();
  }

  try {
    const visitorPayload = await getExistingVisitorToken();
    if (!visitorPayload) {
      notFound();
    }

    const visitorIdentity = deriveContentVisitorIdentity(parsedBoardId.data, visitorPayload);
    const board = await getTargetBoardSnapshot(
      parsedBoardId.data,
      visitorPayload,
      visitorIdentity,
    );
    return <BoardPageClient boardId={parsedBoardId.data} initialBoard={board} />;
  } catch (error) {
    const normalizedError = normalizePrismaError(error);

    if (normalizedError instanceof ApiError && normalizedError.status === 404) {
      notFound();
    }

    if (
      normalizedError instanceof ApiError &&
      normalizedError.status === 503 &&
      normalizedError.code === DATABASE_UNAVAILABLE_CODE
    ) {
      return (
        <main className="mx-auto flex min-h-[100dvh] w-full max-w-2xl items-center px-5 py-12 sm:px-8">
          <section className="w-full border-l-2 border-amber-500 pl-5">
            <p className="text-sm font-medium text-amber-800">Сервис недоступен</p>
            <h1 className="mt-2 text-2xl font-semibold">Не удалось подключиться к PostgreSQL</h1>
            <p className="mt-4 text-sm leading-6 text-muted-foreground">
              Доска не может загрузиться, потому что приложение не видит базу данных по адресу
              {" "}
              <code>localhost:5432</code>.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Запустите локальную БД командой <code>npm run db:start</code>, затем примените миграции
              {" "}
              <code>npm run prisma:deploy</code>.
            </p>
          </section>
        </main>
      );
    }

    throw normalizedError;
  }
}

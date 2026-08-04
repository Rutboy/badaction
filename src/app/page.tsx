import { HomePageClient } from "@/components/home-page-client";
import { getExistingVisitorToken } from "@/lib/cookies/visitor-token";
import { ApiError } from "@/lib/errors/api-error";
import { listAccessibleBoards } from "@/lib/access/session-service";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const visitorPayload = await getExistingVisitorToken();
  if (!visitorPayload) {
    return <HomePageClient boards={[]} />;
  }

  try {
    return <HomePageClient boards={await listAccessibleBoards(visitorPayload)} />;
  } catch (error) {
    if (error instanceof ApiError && error.code === "ANONYMOUS_SESSION_INACTIVE") {
      return <HomePageClient boards={[]} />;
    }
    throw error;
  }
}

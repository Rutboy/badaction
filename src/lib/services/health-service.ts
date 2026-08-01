import { prisma } from "@/lib/prisma/client";
import { withTimeout } from "@/lib/http/timeout";

const DATABASE_HEALTH_TIMEOUT_MS = 1_500;

export const isDatabaseHealthy = async () => {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, DATABASE_HEALTH_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
};

import { validateRuntimeConfiguration } from "@/lib/http/runtime-config";
import { createHealthResponse } from "@/lib/runtime/health-response";
import { isDatabaseHealthy } from "@/lib/services/health-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return createHealthResponse(request, {
    isDatabaseHealthy,
    validateRuntimeConfiguration,
  });
}

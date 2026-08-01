import { isApplicationDraining } from "./application-draining.ts";

type HealthResponseDependencies = {
  isApplicationDraining?: () => boolean;
  isDatabaseHealthy: () => Promise<boolean>;
  validateRuntimeConfiguration: (requestUrl: string) => void;
};

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

const unavailableResponse = () =>
  Response.json(
    { status: "unavailable" },
    { status: 503, headers: RESPONSE_HEADERS },
  );

export const createHealthResponse = async (
  request: Request,
  {
    isApplicationDraining: checkApplicationDraining = isApplicationDraining,
    isDatabaseHealthy,
    validateRuntimeConfiguration,
  }: HealthResponseDependencies,
): Promise<Response> => {
  if (checkApplicationDraining()) {
    return unavailableResponse();
  }

  let healthy = false;
  try {
    validateRuntimeConfiguration(request.url);
    healthy = await isDatabaseHealthy();
  } catch {
    healthy = false;
  }

  if (!healthy) {
    return unavailableResponse();
  }

  return Response.json({ status: "ok" }, { headers: RESPONSE_HEADERS });
};

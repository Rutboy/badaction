import { ApiError } from "./api-error-base.ts";
import { normalizePrismaError } from "./prisma.ts";

const getErrorResponseHeaders = (error: ApiError) => {
  const headers = new Headers({ "Cache-Control": "no-store" });
  const retryAfterSeconds = error.details?.retryAfterSeconds;

  if (
    error.status === 429 &&
    typeof retryAfterSeconds === "number" &&
    Number.isFinite(retryAfterSeconds) &&
    retryAfterSeconds > 0
  ) {
    headers.set("Retry-After", Math.ceil(retryAfterSeconds).toString());
  }

  return headers;
};

export const toErrorResponse = (error: unknown): Response => {
  const normalizedError = normalizePrismaError(error);

  if (normalizedError instanceof ApiError) {
    return Response.json(
      {
        error: {
          code: normalizedError.code,
          message: normalizedError.message,
          details: normalizedError.details,
        },
      },
      { status: normalizedError.status, headers: getErrorResponseHeaders(normalizedError) },
    );
  }

  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error.",
      },
    },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
};

export { ApiError };

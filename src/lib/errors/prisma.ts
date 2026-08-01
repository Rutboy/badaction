import { ApiError } from "./api-error-base.ts";

const DATABASE_UNAVAILABLE_CODE = "DATABASE_UNAVAILABLE";

const hasMessage = (error: unknown): error is { message: string } =>
  typeof error === "object" && error !== null && "message" in error && typeof error.message === "string";

const hasName = (error: unknown): error is { name: string } =>
  typeof error === "object" && error !== null && "name" in error && typeof error.name === "string";

export const isDatabaseUnavailableError = (error: unknown) => {
  if (!hasMessage(error) || !hasName(error)) {
    return false;
  }

  return (
    error.name === "PrismaClientInitializationError" &&
    /can't reach database server/i.test(error.message)
  );
};

export const normalizePrismaError = (error: unknown) => {
  if (isDatabaseUnavailableError(error)) {
    return new ApiError(
      503,
      DATABASE_UNAVAILABLE_CODE,
      "База данных недоступна. Запустите PostgreSQL и повторите запрос.",
    );
  }

  return error;
};

export { DATABASE_UNAVAILABLE_CODE };

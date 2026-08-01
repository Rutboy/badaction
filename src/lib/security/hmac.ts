import { createHmac, timingSafeEqual } from "node:crypto";

const MIN_PRODUCTION_SECRET_LENGTH = 32;
const INSECURE_SECRET_MARKERS = [
  "change-me",
  "changeme",
  "dev-only",
  "development-only",
  "example-secret",
  "placeholder",
  "replace-me",
];
const INDEPENDENT_SECRET_NAMES = [
  "VISITOR_TOKEN_SECRET",
  "BOARD_ACCESS_SECRET",
  "RATE_LIMIT_KEY_SECRET",
] as const;

const isKnownInsecureSecret = (value: string) => {
  const normalized = value.toLowerCase();
  return INSECURE_SECRET_MARKERS.some((marker) => normalized.includes(marker));
};

export const getServerSecret = ({
  env,
  name,
  developmentFallback,
}: {
  env: NodeJS.ProcessEnv;
  name: string;
  developmentFallback: string;
}) => {
  const value = env[name]?.trim();

  if (value) {
    if (
      env.NODE_ENV === "production" &&
      (value.length < MIN_PRODUCTION_SECRET_LENGTH || isKnownInsecureSecret(value))
    ) {
      throw new Error(
        `${name} must be a non-placeholder secret with at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`,
      );
    }

    if (
      env.NODE_ENV === "production" &&
      INDEPENDENT_SECRET_NAMES.includes(
        name as (typeof INDEPENDENT_SECRET_NAMES)[number],
      )
    ) {
      const duplicateName = INDEPENDENT_SECRET_NAMES.find(
        (candidate) => candidate !== name && env[candidate]?.trim() === value,
      );
      if (duplicateName) {
        throw new Error(`${name} must be different from ${duplicateName}`);
      }
    }

    return value;
  }

  if (env.NODE_ENV === "production") {
    throw new Error(`${name} is required in production`);
  }

  return developmentFallback;
};

export const hmacSha256 = (secret: string, value: string) =>
  createHmac("sha256", secret).update(value, "utf8").digest("base64url");

export const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

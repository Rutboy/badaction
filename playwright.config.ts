import { defineConfig, devices } from "@playwright/test";

if (process.env.TEST_DATABASE_IS_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_IS_DISPOSABLE=1 only for an isolated PostgreSQL test database",
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for Playwright E2E tests");
}

if (
  process.env.PLAYWRIGHT_EXTERNAL_SERVER !== undefined &&
  !["0", "1"].includes(process.env.PLAYWRIGHT_EXTERNAL_SERVER)
) {
  throw new Error("PLAYWRIGHT_EXTERNAL_SERVER must be 0 or 1");
}
const externalServer = process.env.PLAYWRIGHT_EXTERNAL_SERVER === "1";
if (
  process.env.PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE !== undefined &&
  !["0", "1"].includes(process.env.PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE)
) {
  throw new Error("PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE must be 0 or 1");
}
if (
  externalServer &&
  process.env.PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE !== "1"
) {
  throw new Error(
    "Set PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE=1 only when the external app uses disposable data",
  );
}
if (
  !externalServer &&
  process.env.PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE !== undefined
) {
  throw new Error(
    "PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE requires PLAYWRIGHT_EXTERNAL_SERVER=1",
  );
}

const portValue = process.env.E2E_PORT ?? "3100";
if (!/^\d+$/.test(portValue)) {
  throw new Error("E2E_PORT must be an integer between 1024 and 65535");
}

const port = Number(portValue);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("E2E_PORT must be an integer between 1024 and 65535");
}

const assertLoopbackOrigin = (value: string, setting: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${setting} must be a valid loopback HTTP origin`);
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "localhost" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${setting} must be a valid loopback HTTP origin`);
  }
  return url.origin;
};

let baseURL = `http://localhost:${port}`;
if (externalServer) {
  if (!process.env.PLAYWRIGHT_BASE_URL) {
    throw new Error(
      "PLAYWRIGHT_BASE_URL is required with PLAYWRIGHT_EXTERNAL_SERVER=1",
    );
  }
  baseURL = assertLoopbackOrigin(
    process.env.PLAYWRIGHT_BASE_URL,
    "PLAYWRIGHT_BASE_URL",
  );
  if (
    !process.env.APP_ORIGIN ||
    assertLoopbackOrigin(process.env.APP_ORIGIN, "APP_ORIGIN") !== baseURL
  ) {
    throw new Error(
      "APP_ORIGIN must match PLAYWRIGHT_BASE_URL in external-server mode",
    );
  }
} else if (process.env.PLAYWRIGHT_BASE_URL !== undefined) {
  throw new Error("PLAYWRIGHT_BASE_URL requires PLAYWRIGHT_EXTERNAL_SERVER=1");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: {
    timeout: 20_000,
  },
  reporter: process.env.CI
    ? [
        ["./e2e/release-gate-reporter.ts"],
        ["line"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : [
        ["./e2e/release-gate-reporter.ts"],
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "ru-RU",
    timezoneId: "UTC",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: externalServer
    ? undefined
    : {
        command: `npm run dev -- --hostname localhost --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          APP_ORIGIN: baseURL,
          VISITOR_TOKEN_SECRET:
            "stage6_e2e_visitor_token_secret_1234567890abcdef",
          BOARD_ACCESS_SECRET:
            "stage6_e2e_board_access_secret_1234567890abcdef",
          RATE_LIMIT_KEY_SECRET:
            "stage6_e2e_rate_limit_secret_1234567890abcdef",
          TRUSTED_PROXY_HOPS: "0",
          BOARD_RETENTION_DAYS: "90",
          BOARD_CARD_LIMIT: "500",
          // The E2E wrapper migrates only a temporary Prisma schema. Cleanup
          // coordination uses a separate pg connection and the public schema,
          // so it is verified by the dedicated DB and production smoke tests.
          RETENTION_CLEANUP_ENABLED: "false",
          RETENTION_CLEANUP_INTERVAL_MINUTES: "60",
          RETENTION_CLEANUP_BATCH_SIZE: "1000",
          NEXT_TELEMETRY_DISABLED: "1",
        },
      },
});

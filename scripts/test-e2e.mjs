import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.TEST_DATABASE_IS_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_IS_DISPOSABLE=1 only for an isolated PostgreSQL test database",
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Playwright E2E tests");
}

let parsedDatabaseUrl;
try {
  parsedDatabaseUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
}
if (
  parsedDatabaseUrl.protocol !== "postgres:" &&
  parsedDatabaseUrl.protocol !== "postgresql:"
) {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
}

const updateScreenshotFlag = "--update-product-screenshot";
const updateProductScreenshot = process.argv.includes(updateScreenshotFlag);
const forwardedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== updateScreenshotFlag);

const reservePort = () =>
  new Promise((resolve, reject) => {
    const reservation = createServer();
    reservation.once("error", reject);
    reservation.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        reservation.close();
        reject(new Error("Could not reserve a Playwright web server port"));
        return;
      }
      reservation.close((error) => {
        if (error) {
          reject(new Error("Could not release the Playwright web server port"));
          return;
        }
        resolve(address.port);
      });
    });
  });

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
const e2ePort =
  process.env.E2E_PORT ??
  (externalServer ? "3100" : String(await reservePort()));
const schemaName = `stage6_e2e_${process.pid}_${randomBytes(6).toString("hex")}`;
if (!/^[a-z][a-z0-9_]+$/.test(schemaName)) {
  throw new Error("Generated an unsafe temporary E2E schema name");
}

const targetDatabaseUrl = new URL(parsedDatabaseUrl);
if (!externalServer) {
  targetDatabaseUrl.searchParams.set("schema", schemaName);
}

const admin = externalServer
  ? null
  : new PrismaClient({ datasourceUrl: databaseUrl });
let schemaCreated = false;
let playwrightProcess = null;
let interruptedSignal = null;
const interruptController = new AbortController();
let forceExitReady = false;
let forceExitTimer = null;

const signalExitCodes = new Map([
  ["SIGINT", 130],
  ["SIGTERM", 143],
]);
const signalHandlers = new Map(
  [...signalExitCodes.keys()].map((signal) => [
    signal,
    () => {
      if (interruptedSignal) {
        if (forceExitReady) {
          playwrightProcess?.kill("SIGKILL");
          process.exit(signalExitCodes.get(signal) ?? 1);
        }
        return;
      }
      interruptedSignal = signal;
      forceExitTimer = setTimeout(() => {
        forceExitReady = true;
      }, 2_000);
      forceExitTimer.unref();
      interruptController.abort(new Error(`E2E run interrupted by ${signal}`));
      playwrightProcess?.kill(signal);
    },
  ]),
);
for (const [signal, handler] of signalHandlers) {
  process.on(signal, handler);
}

const playwrightCli = fileURLToPath(
  new URL("../node_modules/@playwright/test/cli.js", import.meta.url),
);
const runPlaywright = () => {
  if (interruptedSignal) {
    return Promise.reject(
      new Error(`E2E run interrupted by ${interruptedSignal}`),
    );
  }
  const child = spawn(
    process.execPath,
    [playwrightCli, "test", ...forwardedArguments],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        DATABASE_URL: targetDatabaseUrl.toString(),
        E2E_PORT: e2ePort,
        UPDATE_PRODUCT_SCREENSHOT: updateProductScreenshot ? "1" : "0",
      },
      stdio: "inherit",
    },
  );
  playwrightProcess = child;

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      playwrightProcess = null;
      reject(error);
    });
    child.once("exit", (code, signal) => {
      playwrightProcess = null;
      if (signal) {
        reject(new Error(`Playwright exited after ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });
};

let executionError = null;
try {
  if (admin) {
    await admin.$connect();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    try {
      await execFileAsync(
        process.execPath,
        [
          join(repositoryRoot, "node_modules/prisma/build/index.js"),
          "migrate",
          "deploy",
          "--schema",
          join(repositoryRoot, "prisma/schema.prisma"),
        ],
        {
          cwd: repositoryRoot,
          env: {
            ...process.env,
            DATABASE_URL: targetDatabaseUrl.toString(),
          },
          maxBuffer: 5 * 1024 * 1024,
          signal: interruptController.signal,
          timeout: 180_000,
        },
      );
    } catch {
      throw new Error("Could not apply migrations to the temporary E2E schema");
    }
  }

  process.exitCode = await runPlaywright();
} catch (error) {
  executionError = error;
} finally {
  if (admin && schemaCreated) {
    try {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    } catch {
      console.error("Could not remove the temporary E2E schema");
      process.exitCode = 1;
    }
  }
  try {
    await admin?.$disconnect();
  } finally {
    if (forceExitTimer) {
      clearTimeout(forceExitTimer);
    }
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
  }
}

if (interruptedSignal) {
  process.exitCode = signalExitCodes.get(interruptedSignal) ?? 1;
} else if (executionError) {
  throw executionError;
}

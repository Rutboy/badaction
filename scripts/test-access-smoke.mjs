import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (process.env.TEST_DATABASE_IS_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_IS_DISPOSABLE=1 only for an isolated PostgreSQL test database",
  );
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the access smoke test");
}

const listenHostname = "127.0.0.1";
const portValue = process.env.ACCESS_SMOKE_PORT;
let requestedPort = 0;
if (portValue !== undefined) {
  if (!/^\d+$/.test(portValue)) {
    throw new Error("ACCESS_SMOKE_PORT must be an integer between 1024 and 65535");
  }

  requestedPort = Number(portValue);
  if (!Number.isSafeInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
    throw new Error("ACCESS_SMOKE_PORT must be an integer between 1024 and 65535");
  }
}

const port = await new Promise((resolve, reject) => {
  const reservation = createServer();
  reservation.once("error", () => {
    reject(new Error("ACCESS_SMOKE_PORT is unavailable"));
  });
  reservation.listen({ host: listenHostname, port: requestedPort, exclusive: true }, () => {
    const address = reservation.address();
    if (!address || typeof address === "string") {
      reservation.close();
      reject(new Error("Could not reserve an access smoke port"));
      return;
    }

    reservation.close((error) => {
      if (error) {
        reject(new Error("Could not release the reserved access smoke port"));
        return;
      }
      resolve(address.port);
    });
  });
});
const baseUrl = `http://${listenHostname}:${port}`;
const appOrigin = `http://localhost:${port}`;
const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
const application = spawn(
  process.execPath,
  [nextCli, "start", "--hostname", listenHostname, "--port", String(port)],
  {
    env: {
      ...process.env,
      NODE_ENV: "production",
      APP_ORIGIN: appOrigin,
      VISITOR_TOKEN_SECRET: "stage0_access_smoke_visitor_secret_1234567890abcdef",
      BOARD_ACCESS_SECRET: "stage0_access_smoke_board_secret_1234567890abcdef",
      RATE_LIMIT_KEY_SECRET: "stage0_access_smoke_rate_limit_secret_1234567890abcdef",
      TRUSTED_PROXY_HOPS: "0",
      BOARD_RETENTION_DAYS: "90",
      BOARD_CARD_LIMIT: "500",
    },
    stdio: "ignore",
  },
);

let applicationExited = false;
let applicationStartError = false;
const applicationExit = new Promise((resolve) => {
  application.once("error", () => {
    applicationExited = true;
    applicationStartError = true;
    resolve({ code: null, signal: null });
  });
  application.once("exit", (code, signal) => {
    applicationExited = true;
    resolve({ code, signal });
  });
});

const throwApplicationExit = async () => {
  const result = await applicationExit;
  if (applicationStartError) {
    throw new Error("Application process failed to start");
  }
  throw new Error(
    `Application exited before readiness (code ${result.code}, signal ${result.signal})`,
  );
};

const signalApplication = (signal) => {
  if (!application.pid || applicationExited) return;

  try {
    application.kill(signal);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("ESRCH")) {
      throw error;
    }
  }
};

const stopApplication = async () => {
  signalApplication("SIGTERM");
  await Promise.race([applicationExit, delay(5_000)]);
  if (!applicationExited) {
    signalApplication("SIGKILL");
    await applicationExit;
  }
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (applicationExited) {
      await throwApplicationExit();
    }

    try {
      const response = await fetch(`${baseUrl}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(1_500),
      });
      if (response.status === 200) {
        await Promise.race([applicationExit, delay(100)]);
        if (applicationExited) {
          await throwApplicationExit();
        }
        ready = true;
        break;
      }
    } catch {
      // Startup connection failures are expected until Next.js begins listening.
    }

    await delay(500);
  }

  if (!ready) {
    throw new Error("Application did not become ready for the access smoke test");
  }

  const smoke = spawn(process.execPath, ["scripts/smoke-access.mjs"], {
    env: {
      ...process.env,
      SMOKE_BASE_URL: baseUrl,
      SMOKE_ORIGIN: appOrigin,
    },
    stdio: "inherit",
  });
  let smokeTimedOut = false;
  const smokeTimeout = setTimeout(() => {
    smokeTimedOut = true;
    smoke.kill("SIGKILL");
  }, 120_000);
  smokeTimeout.unref();
  const smokeExitCode = await new Promise((resolve, reject) => {
    smoke.once("error", reject);
    smoke.once("exit", (code, signal) => {
      if (signal && !smokeTimedOut) {
        reject(new Error(`Access smoke process exited after ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  }).finally(() => clearTimeout(smokeTimeout));
  if (smokeTimedOut) {
    throw new Error("Access smoke exceeded its 120 second deadline");
  }
  if (smokeExitCode !== 0) {
    process.exitCode = smokeExitCode;
  }
} finally {
  await stopApplication();
}

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

if (process.env.TEST_DATABASE_IS_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_IS_DISPOSABLE=1 to allow an isolated Docker test volume",
  );
}

const skipBuild = process.env.DOCKER_SMOKE_SKIP_BUILD === "1";
const productionMode = process.env.DOCKER_SMOKE_PRODUCTION === "1";
if (
  process.env.DOCKER_SMOKE_SKIP_BUILD !== undefined &&
  !["0", "1"].includes(process.env.DOCKER_SMOKE_SKIP_BUILD)
) {
  throw new Error("DOCKER_SMOKE_SKIP_BUILD must be 0 or 1");
}
if (
  process.env.DOCKER_SMOKE_PRODUCTION !== undefined &&
  !["0", "1"].includes(process.env.DOCKER_SMOKE_PRODUCTION)
) {
  throw new Error("DOCKER_SMOKE_PRODUCTION must be 0 or 1");
}
if (
  skipBuild &&
  (!process.env.DOCKER_RUNNER_IMAGE || !process.env.DOCKER_MIGRATOR_IMAGE)
) {
  throw new Error(
    "DOCKER_SMOKE_SKIP_BUILD=1 requires explicit DOCKER_RUNNER_IMAGE and DOCKER_MIGRATOR_IMAGE",
  );
}

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const composeFile = fileURLToPath(
  new URL("../docker-compose.yml", import.meta.url),
);
const productionComposeFile = fileURLToPath(
  new URL("../docker-compose.production.yml", import.meta.url),
);
const projectName = `badaction-e2e-${process.pid}-${randomBytes(4).toString("hex")}`;
const databaseName = "retro_e2e";
const databaseUser = productionMode ? "badaction_admin" : "postgres";
const databasePassword = "docker_e2e_admin_password_1234567890abcdef";
const migratorUser = "badaction_migrator";
const migratorPassword = "docker_e2e_migrator_password_1234567890abcdef";
const runtimeUser = "badaction_app";
const runtimePassword = "docker_e2e_runtime_password_1234567890abcdef";
const shutdownBlockerApplicationName = "badaction-docker-shutdown-blocker";
const boardIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const activeProcesses = new Set();
let interruptedSignal = null;
const interruptController = new AbortController();
let forceExitReady = false;
let forceExitTimer = null;

const ensureNotInterrupted = () => {
  if (interruptedSignal) {
    throw new Error(`Docker smoke interrupted by ${interruptedSignal}`);
  }
};
const requestSignal = (timeoutMs) =>
  AbortSignal.any([interruptController.signal, AbortSignal.timeout(timeoutMs)]);

const runCommand = (
  command,
  args,
  {
    env = process.env,
    capture = false,
    timeoutMs = 900_000,
    allowAfterInterrupt = false,
  } = {},
) => {
  if (interruptedSignal && !allowAfterInterrupt) {
    return Promise.reject(
      new Error(`Docker smoke interrupted by ${interruptedSignal}`),
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    activeProcesses.add(child);
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timeout.unref();

    child.once("error", (error) => {
      clearTimeout(timeout);
      activeProcesses.delete(child);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      activeProcesses.delete(child);
      if (timedOut) {
        reject(new Error(`${command} exceeded its ${timeoutMs}ms deadline`));
        return;
      }
      if (signal || code !== 0) {
        const detail = capture && stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(
          new Error(
            `${command} exited with ${signal ?? `code ${code ?? "unknown"}`}${detail}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
};

const reservePorts = async (count) => {
  const reservations = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const reservation = createServer();
      await new Promise((resolve, reject) => {
        reservation.once("error", reject);
        reservation.listen(
          { host: "127.0.0.1", port: 0, exclusive: true },
          resolve,
        );
      });
      reservations.push(reservation);
    }
    return reservations.map((reservation) => {
      const address = reservation.address();
      if (!address || typeof address === "string") {
        throw new Error("Could not reserve a Docker smoke port");
      }
      return address.port;
    });
  } finally {
    await Promise.all(
      reservations.map(
        (reservation) =>
          new Promise((resolve) => reservation.close(() => resolve())),
      ),
    );
  }
};

const [applicationPort, postgresPort] = await reservePorts(2);
const baseUrl = `http://127.0.0.1:${applicationPort}`;
const canonicalOrigin = `http://localhost:${applicationPort}`;
const composeEnv = {
  ...process.env,
  APP_PORT: String(applicationPort),
  POSTGRES_PORT: String(postgresPort),
  POSTGRES_DB: databaseName,
  POSTGRES_USER: databaseUser,
  POSTGRES_PASSWORD: databasePassword,
  DOCKER_DATABASE_URL: `postgresql://${databaseUser}:${databasePassword}@postgres:5432/${databaseName}?schema=public`,
  POSTGRES_MIGRATOR_USER: migratorUser,
  POSTGRES_MIGRATOR_PASSWORD: migratorPassword,
  POSTGRES_RUNTIME_USER: runtimeUser,
  POSTGRES_RUNTIME_PASSWORD: runtimePassword,
  DOCKER_MIGRATOR_DATABASE_URL: `postgresql://${migratorUser}:${migratorPassword}@postgres:5432/${databaseName}?schema=public`,
  DOCKER_RUNTIME_DATABASE_URL: `postgresql://${runtimeUser}:${runtimePassword}@postgres:5432/${databaseName}?schema=public`,
  DOCKER_VISITOR_TOKEN_SECRET:
    "docker_e2e_visitor_token_secret_1234567890abcdef",
  DOCKER_BOARD_ACCESS_SECRET: "docker_e2e_board_access_secret_1234567890abcdef",
  DOCKER_RATE_LIMIT_KEY_SECRET: "docker_e2e_rate_limit_secret_1234567890abcdef",
  DOCKER_APP_ORIGIN: canonicalOrigin,
  TRUSTED_PROXY_HOPS: "0",
  BOARD_RETENTION_DAYS: "90",
  BOARD_CARD_LIMIT: "500",
  RETENTION_CLEANUP_ENABLED: "true",
  RETENTION_CLEANUP_INTERVAL_MINUTES: "5",
  RETENTION_CLEANUP_BATCH_SIZE: "1000",
  NEXT_TELEMETRY_DISABLED: "1",
};
for (const setting of [
  "COMPOSE_FILE",
  "COMPOSE_PROJECT_NAME",
  "COMPOSE_PROFILES",
  "COMPOSE_ENV_FILES",
]) {
  delete composeEnv[setting];
}
const composePrefix = [
  "compose",
  "--file",
  composeFile,
  ...(productionMode ? ["--file", productionComposeFile] : []),
  "--project-directory",
  repositoryRoot,
  "--project-name",
  projectName,
];
const runCompose = (args, options = {}) =>
  runCommand("docker", [...composePrefix, ...args], {
    env: composeEnv,
    ...options,
  });

const fetchHealth = async () => {
  try {
    return await fetch(`${baseUrl}/api/health`, {
      cache: "no-store",
      signal: requestSignal(1_000),
    });
  } catch {
    return null;
  }
};

const waitForHealthyApplication = async () => {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    ensureNotInterrupted();
    const response = await fetchHealth();
    if (response?.status === 200) {
      return;
    }
    await delay(500);
  }
  throw new Error("Docker application did not become healthy in time");
};

const runAccessSmoke = async () => {
  await runCommand(process.execPath, ["scripts/smoke-access.mjs"], {
    env: {
      ...process.env,
      SMOKE_BASE_URL: baseUrl,
      SMOKE_ORIGIN: canonicalOrigin,
    },
    timeoutMs: 180_000,
  });
};

const createPersistenceProbe = async () => {
  const response = await fetch(`${baseUrl}/api/boards`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: canonicalOrigin,
    },
    body: JSON.stringify({ title: "Docker restart probe" }),
    signal: requestSignal(10_000),
  });
  if (response.status !== 201) {
    throw new Error(
      `Docker persistence probe creation returned ${response.status}`,
    );
  }
  const board = await response.json();
  const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!boardIdPattern.test(board.id) || !cookie) {
    throw new Error(
      "Docker persistence probe did not return board access state",
    );
  }
  return { boardId: board.id, cookie };
};

const assertPersistenceProbe = async ({ boardId, cookie }) => {
  const response = await fetch(`${baseUrl}/api/boards/${boardId}`, {
    headers: { Cookie: cookie },
    signal: requestSignal(10_000),
  });
  if (response.status !== 200) {
    throw new Error(
      `Docker persistence probe returned ${response.status} after restart`,
    );
  }
  const board = await response.json();
  if (board.id !== boardId || board.title !== "Docker restart probe") {
    throw new Error("Docker persistence probe changed after restart");
  }
};

const runPostgres = (sql, options = {}) =>
  runCompose(
    [
      "exec",
      "--no-TTY",
      "postgres",
      "psql",
      "--username",
      databaseUser,
      "--dbname",
      databaseName,
      "--set",
      "ON_ERROR_STOP=1",
      "--tuples-only",
      "--no-align",
      "--command",
      sql,
    ],
    options,
  );

const expirePersistenceProbe = async (boardId) => {
  if (!boardIdPattern.test(boardId)) {
    throw new Error("Refusing to expire an invalid board ID");
  }
  await runPostgres(
    `UPDATE "boards" SET "expires_at" = "created_at" + INTERVAL '1 millisecond' WHERE "id" = '${boardId}'::uuid; DELETE FROM "rate_limit_buckets" WHERE "key" = 'system:retention-cleanup-schedule';`,
  );
};

const assertProductionDatabaseRoles = async () => {
  if (!productionMode) return;

  const result = await runPostgres(
    `SELECT string_agg("rolname" || ':' || "rolsuper" || ':' || "rolcreatedb" || ':' || "rolcreaterole", ',' ORDER BY "rolname") FROM "pg_roles" WHERE "rolname" IN ('${migratorUser}', '${runtimeUser}');`,
    { capture: true, timeoutMs: 10_000 },
  );
  const expected = `${runtimeUser}:false:false:false,${migratorUser}:false:false:false`;
  if (result.stdout.trim() !== expected) {
    throw new Error(
      `Unexpected production database roles: ${result.stdout.trim()}`,
    );
  }

  const owner = await runPostgres(
    `SELECT "tableowner" FROM "pg_tables" WHERE "schemaname" = 'public' AND "tablename" = 'boards';`,
    { capture: true, timeoutMs: 10_000 },
  );
  if (owner.stdout.trim() !== migratorUser) {
    throw new Error("Production tables are not owned by the migrator role");
  }

  const privileges = await runPostgres(
    `SELECT has_database_privilege('${runtimeUser}', '${databaseName}', 'CREATE'), has_database_privilege('${migratorUser}', '${databaseName}', 'CREATE'), has_schema_privilege('${runtimeUser}', 'public', 'CREATE'), has_schema_privilege('${runtimeUser}', 'public', 'USAGE'), has_table_privilege('${runtimeUser}', 'public.boards', 'SELECT'), has_table_privilege('${runtimeUser}', 'public.boards', 'INSERT'), has_table_privilege('${runtimeUser}', 'public.boards', 'UPDATE'), has_table_privilege('${runtimeUser}', 'public.boards', 'DELETE'), has_table_privilege('${runtimeUser}', 'public._prisma_migrations', 'SELECT'), has_table_privilege('${runtimeUser}', 'public._prisma_migrations', 'INSERT'), has_table_privilege('${runtimeUser}', 'public._prisma_migrations', 'UPDATE'), has_table_privilege('${runtimeUser}', 'public._prisma_migrations', 'DELETE');`,
    { capture: true, timeoutMs: 10_000 },
  );
  if (privileges.stdout.trim() !== "f|t|f|t|t|t|t|t|f|f|f|f") {
    throw new Error(
      `Unexpected production runtime privileges: ${privileges.stdout.trim()}`,
    );
  }
};

const waitForCleanup = async (boardId) => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    ensureNotInterrupted();
    const result = await runPostgres(
      `SELECT COUNT(*) FROM "boards" WHERE "id" = '${boardId}'::uuid;`,
      { capture: true, timeoutMs: 10_000 },
    );
    if (result.stdout.trim() === "0") {
      return;
    }
    await delay(500);
  }
  throw new Error("Startup retention cleanup did not delete the expired board");
};

const startShutdownBlocker = async () => {
  let finished = false;
  let releaseRequested = false;
  let blockerError;
  let releasePromise;
  const blocker = runCompose(
    [
      "exec",
      "--no-TTY",
      "--env",
      `PGAPPNAME=${shutdownBlockerApplicationName}`,
      "postgres",
      "psql",
      "--username",
      databaseUser,
      "--dbname",
      databaseName,
      "--set",
      "ON_ERROR_STOP=1",
      "--command",
      `BEGIN; LOCK TABLE "rate_limit_buckets" IN ACCESS EXCLUSIVE MODE; SELECT pg_sleep(120); COMMIT;`,
    ],
    { capture: true, timeoutMs: 150_000 },
  )
    .then(
      () => {
        if (!releaseRequested) {
          blockerError = new Error("Docker shutdown blocker exited early");
        }
      },
      (error) => {
        if (!releaseRequested) {
          blockerError = error;
        }
      },
    )
    .finally(() => {
      finished = true;
    });

  const release = () => {
    releasePromise ??= (async () => {
      releaseRequested = true;
      const termination = await runPostgres(
        `SELECT COUNT(*) FROM (SELECT pg_terminate_backend("pid") AS "terminated" FROM "pg_stat_activity" WHERE "application_name" = '${shutdownBlockerApplicationName}' AND "pid" <> pg_backend_pid()) AS "terminated_backends" WHERE "terminated";`,
        {
          capture: true,
          timeoutMs: 10_000,
          allowAfterInterrupt: true,
        },
      );
      await blocker;
      if (blockerError) {
        throw blockerError;
      }
      if (Number(termination.stdout.trim()) < 1) {
        throw new Error("Docker shutdown blocker backend was not terminated");
      }
    })();
    return releasePromise;
  };

  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      ensureNotInterrupted();
      const result = await runPostgres(
        `SELECT COUNT(*) FROM "pg_locks" AS held_lock JOIN "pg_stat_activity" AS activity ON activity."pid" = held_lock."pid" WHERE activity."application_name" = '${shutdownBlockerApplicationName}' AND held_lock."relation" = '"rate_limit_buckets"'::regclass AND held_lock."mode" = 'AccessExclusiveLock' AND held_lock."granted";`,
        { capture: true, timeoutMs: 10_000 },
      );
      if (Number(result.stdout.trim()) > 0) {
        return { release };
      }
      if (finished) {
        throw blockerError ?? new Error("Docker shutdown blocker exited early");
      }
      await delay(100);
    }
    throw new Error("Docker shutdown blocker did not acquire its table lock");
  } catch (error) {
    await release();
    throw error;
  }
};

const waitForBlockedStartupCleanup = async () => {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    ensureNotInterrupted();
    const result = await runPostgres(
      `SELECT COUNT(*) FROM "pg_locks" AS pending_lock JOIN "pg_stat_activity" AS activity ON activity."pid" = pending_lock."pid" WHERE activity."application_name" = 'badaction-retention-cleanup' AND pending_lock."relation" = '"rate_limit_buckets"'::regclass AND pending_lock."mode" = 'RowExclusiveLock' AND NOT pending_lock."granted" AND activity."wait_event_type" = 'Lock';`,
      { capture: true, timeoutMs: 10_000 },
    );
    if (Number(result.stdout.trim()) > 0) {
      return;
    }
    await delay(100);
  }
  throw new Error("Startup retention cleanup did not wait on the test lock");
};

const assertGracefulShutdown = async (releaseShutdownBlocker) => {
  let stopFinished = false;
  let stopError;
  let sawDrainingHealth = false;
  let releasePromise;
  let releaseError;
  const stop = runCompose(["stop", "--timeout", "60", "app"], {
    capture: true,
    timeoutMs: 70_000,
  })
    .catch((error) => {
      stopError = error;
    })
    .finally(() => {
      stopFinished = true;
    });

  while (!stopFinished) {
    const response = await fetchHealth();
    if (response?.status === 503) {
      sawDrainingHealth = true;
      releasePromise ??= releaseShutdownBlocker().catch((error) => {
        releaseError = error;
      });
    }
    await delay(10);
  }
  await stop;
  await releasePromise;
  if (releaseError) {
    throw releaseError;
  }
  if (stopError) {
    throw stopError;
  }
  if (!sawDrainingHealth) {
    throw new Error("Docker shutdown did not expose the draining health state");
  }

  const stateResult = await runCompose(
    ["ps", "--all", "--format", "json", "app"],
    { capture: true, timeoutMs: 10_000 },
  );
  const parsed = JSON.parse(stateResult.stdout);
  const state = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!state || state.State !== "exited" || Number(state.ExitCode) !== 0) {
    throw new Error("Docker application did not exit cleanly after SIGTERM");
  }
};

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
          for (const child of activeProcesses) {
            child.kill("SIGKILL");
          }
          process.exit(signalExitCodes.get(signal) ?? 1);
        }
        return;
      }
      interruptedSignal = signal;
      forceExitTimer = setTimeout(() => {
        forceExitReady = true;
      }, 2_000);
      forceExitTimer.unref();
      interruptController.abort(
        new Error(`Docker smoke interrupted by ${signal}`),
      );
      for (const child of activeProcesses) {
        child.kill(signal);
      }
    },
  ]),
);
for (const [signal, handler] of signalHandlers) {
  process.on(signal, handler);
}

const printFailureDiagnostics = async () => {
  if (interruptedSignal) {
    return;
  }
  console.error(`Docker smoke diagnostics for isolated project ${projectName}`);
  await runCompose(["ps", "--all"], {
    allowAfterInterrupt: true,
    timeoutMs: 20_000,
  }).catch(() => console.error("Could not collect Docker Compose status"));
  if (interruptedSignal) {
    return;
  }
  await runCompose(["logs", "--no-color", "--tail", "200"], {
    allowAfterInterrupt: true,
    timeoutMs: 30_000,
  }).catch(() => console.error("Could not collect Docker Compose logs"));
};

const removeComposeProject = async () => {
  const args = [
    "--profile",
    "app",
    "down",
    "--volumes",
    "--remove-orphans",
    "--timeout",
    "20",
  ];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await runCompose(args, {
        allowAfterInterrupt: true,
        timeoutMs: 120_000,
      });
      return;
    } catch {
      if (attempt === 2) {
        console.error(
          `Failed to remove isolated Docker project ${projectName}`,
        );
        process.exitCode = 1;
      }
    }
  }
};

let composeStarted = false;
let executionError = null;
try {
  await runCommand("docker", ["compose", "version"], {
    capture: true,
    timeoutMs: 10_000,
  });
  const upArguments = ["--profile", "app", "up"];
  upArguments.push(skipBuild ? "--no-build" : "--build");
  upArguments.push("--detach", "--wait", "--wait-timeout", "240");
  composeStarted = true;
  await runCompose(upArguments, { timeoutMs: 900_000 });
  await waitForHealthyApplication();
  await assertProductionDatabaseRoles();

  await runAccessSmoke();

  const persistenceProbe = await createPersistenceProbe();
  await runCompose(["restart", "app"], { timeoutMs: 120_000 });
  await waitForHealthyApplication();
  await assertPersistenceProbe(persistenceProbe);

  await expirePersistenceProbe(persistenceProbe.boardId);
  await runCompose(["restart", "app"], { timeoutMs: 120_000 });
  await waitForHealthyApplication();
  await waitForCleanup(persistenceProbe.boardId);

  await runCompose(["stop", "--timeout", "60", "app"], {
    timeoutMs: 70_000,
  });
  const shutdownBlocker = await startShutdownBlocker();
  try {
    await runCompose(["start", "app"], { timeoutMs: 120_000 });
    await waitForHealthyApplication();
    await waitForBlockedStartupCleanup();
    await assertGracefulShutdown(shutdownBlocker.release);
  } finally {
    await shutdownBlocker.release();
  }
  await runCompose(["start", "app"], { timeoutMs: 120_000 });
  await waitForHealthyApplication();

  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        "build-and-migrate",
        ...(productionMode ? ["separate-database-roles"] : []),
        "health",
        "anonymous-access-flow",
        "restart-persistence",
        "startup-retention-cleanup",
        "graceful-shutdown",
      ],
    }),
  );
} catch (error) {
  executionError = error;
} finally {
  if (composeStarted) {
    if (executionError && !interruptedSignal) {
      await printFailureDiagnostics();
    }
    await removeComposeProject();
  }
  if (forceExitTimer) {
    clearTimeout(forceExitTimer);
  }
  for (const [signal, handler] of signalHandlers) {
    process.off(signal, handler);
  }
}

if (interruptedSignal) {
  process.exitCode = signalExitCodes.get(interruptedSignal) ?? 1;
} else if (executionError) {
  if (
    executionError instanceof Error &&
    "code" in executionError &&
    executionError.code === "ENOENT"
  ) {
    throw new Error("Docker CLI with Compose v2 is required for test:docker");
  }
  throw executionError;
}

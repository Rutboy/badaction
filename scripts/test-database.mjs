import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

if (process.env.TEST_DATABASE_IS_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_IS_DISPOSABLE=1 only for an isolated PostgreSQL test database",
  );
}

const readLocalDatabaseUrl = async () => {
  try {
    const localEnvironment = parseEnv(await readFile(".env", "utf8"));
    return localEnvironment.DATABASE_URL;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const databaseUrl = process.env.DATABASE_URL ?? await readLocalDatabaseUrl();
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database tests");
}

const child = spawn(
  process.execPath,
  [
    "--test",
    "--experimental-strip-types",
    "--experimental-specifier-resolution=node",
    "src/**/*.test.js",
  ],
  {
    env: { ...process.env, DATABASE_URL: databaseUrl, RUN_DATABASE_TESTS: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let output = "";
const collectOutput = (chunk, destination) => {
  destination.write(chunk);
  output += chunk.toString();
};

child.stdout.on("data", (chunk) => collectOutput(chunk, process.stdout));
child.stderr.on("data", (chunk) => collectOutput(chunk, process.stderr));

const exitCode = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => {
    if (signal) {
      reject(new Error(`Database test process exited after ${signal}`));
      return;
    }

    resolve(code ?? 1);
  });
});

if (exitCode !== 0) {
  process.exitCode = exitCode;
} else {
  const testCount = Number([...output.matchAll(/^# tests (\d+)$/gm)].at(-1)?.[1]);
  const skippedCount = Number([...output.matchAll(/^# skipped (\d+)$/gm)].at(-1)?.[1]);
  if (!Number.isSafeInteger(testCount) || testCount < 1) {
    throw new Error("Database baseline must execute at least one test");
  }
  if (!Number.isSafeInteger(skippedCount) || skippedCount !== 0) {
    throw new Error("Database baseline must finish with zero skipped tests");
  }
}

import { spawn } from "node:child_process";
import { Client } from "pg";

const runtimeRolePattern = /^[a-z_][a-z0-9_]{0,62}$/;

const runPrismaDeploy = () =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "deploy"],
      {
        env: process.env,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        reject(
          new Error(
            `Prisma migrate deploy exited with ${signal ?? `code ${code ?? "unknown"}`}`,
          ),
        );
        return;
      }
      resolve();
    });
  });

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

const readRuntimeRole = () => {
  const runtimeRole = process.env.DATABASE_RUNTIME_ROLE?.trim();
  if (!runtimeRole) {
    return null;
  }
  if (!runtimeRolePattern.test(runtimeRole)) {
    throw new Error("DATABASE_RUNTIME_ROLE must match [a-z_][a-z0-9_]{0,62}");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  return runtimeRole;
};

const revokeRuntimeMigrationTableAccess = async (runtimeRole) => {
  if (!runtimeRole) {
    return;
  }
  const client = new Client({
    application_name: "badaction-container-migrator",
    connectionString: process.env.DATABASE_URL,
  });
  try {
    await client.connect();
    await client.query(
      `REVOKE ALL PRIVILEGES ON TABLE "public"."_prisma_migrations" FROM ${quoteIdentifier(runtimeRole)}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
};

const runtimeRole = readRuntimeRole();
await runPrismaDeploy();
await revokeRuntimeMigrationTableAccess(runtimeRole);

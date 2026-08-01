import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";

const execFileAsync = promisify(execFile);
const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureDirectory = join(rootDirectory, "tests/fixtures/stage0/upgrade");
const migrationsDirectory = join(rootDirectory, "prisma/migrations");
const prismaCli = join(rootDirectory, "node_modules/prisma/build/index.js");
const databaseUrl = process.env.DATABASE_URL;

if (process.env.RUN_DATABASE_TESTS !== "1") {
  throw new Error("Set RUN_DATABASE_TESTS=1 to run the upgrade baseline test");
}

if (process.env.TEST_DATABASE_IS_DISPOSABLE !== "1") {
  throw new Error(
    "Set TEST_DATABASE_IS_DISPOSABLE=1 only for an isolated PostgreSQL test database",
  );
}

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the upgrade baseline test");
}

const manifest = JSON.parse(
  await readFile(join(fixtureDirectory, "migrations.json"), "utf8"),
);

if (
  manifest.version !== 1
  || !Array.isArray(manifest.migrations)
  || manifest.migrations.length === 0
) {
  throw new Error("Invalid Stage 0 migration manifest");
}

const migrationNames = manifest.migrations.map((migration) => migration.name);
const repositoryMigrationNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (
  migrationNames.some((name, index) => repositoryMigrationNames[index] !== name)
) {
  throw new Error("Migrations were inserted into or removed from the frozen Stage 0 chain");
}

for (const migration of manifest.migrations) {
  if (
    typeof migration.name !== "string"
    || typeof migration.sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(migration.sha256)
  ) {
    throw new Error("Invalid entry in the Stage 0 migration manifest");
  }

  const sql = await readFile(
    join(migrationsDirectory, migration.name, "migration.sql"),
  );
  const checksum = createHash("sha256").update(sql).digest("hex");
  if (checksum !== migration.sha256) {
    throw new Error(`Frozen migration ${migration.name} was modified`);
  }
}

const schemaName = `stage0_upgrade_${process.pid}_${randomBytes(6).toString("hex")}`;
if (!/^[a-z][a-z0-9_]+$/.test(schemaName)) {
  throw new Error("Generated an unsafe temporary schema name");
}

let targetUrl;
try {
  targetUrl = new URL(databaseUrl);
} catch {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
}
if (targetUrl.protocol !== "postgres:" && targetUrl.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
}
targetUrl.searchParams.set("schema", schemaName);
const targetDatabaseUrl = targetUrl.toString();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "badaction-stage0-upgrade-"));
const baselinePrismaDirectory = join(temporaryDirectory, "prisma");
const baselineMigrationsDirectory = join(baselinePrismaDirectory, "migrations");
const baselineSchemaPath = join(baselinePrismaDirectory, "schema.prisma");
const admin = new PrismaClient({ datasourceUrl: databaseUrl });
let schemaCreated = false;

const runPrisma = async (label, args) => {
  try {
    await execFileAsync(process.execPath, [prismaCli, ...args], {
      cwd: rootDirectory,
      env: { ...process.env, DATABASE_URL: targetDatabaseUrl },
      maxBuffer: 5 * 1024 * 1024,
      timeout: 120_000,
    });
  } catch (error) {
    const diagnostic = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr)
          .replaceAll(/postgres(?:ql)?:\/\/\S+/gi, "[database-url-redacted]")
          .trim()
      : "";
    throw new Error(
      diagnostic ? `${label} failed: ${diagnostic}` : `${label} failed`,
    );
  }
};

try {
  await admin.$connect();
  await admin.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  schemaCreated = true;

  await mkdir(baselineMigrationsDirectory, { recursive: true });
  await writeFile(
    baselineSchemaPath,
    [
      "datasource db {",
      '  provider = "postgresql"',
      '  url      = env("DATABASE_URL")',
      "}",
      "",
    ].join("\n"),
  );
  await cp(
    join(migrationsDirectory, "migration_lock.toml"),
    join(baselineMigrationsDirectory, "migration_lock.toml"),
  );
  for (const migrationName of migrationNames) {
    await cp(
      join(migrationsDirectory, migrationName),
      join(baselineMigrationsDirectory, migrationName),
      { recursive: true },
    );
  }

  await runPrisma("Frozen baseline migration deploy", [
    "migrate",
    "deploy",
    "--schema",
    baselineSchemaPath,
  ]);
  await runPrisma("Production-like baseline seed", [
    "db",
    "execute",
    "--file",
    join(fixtureDirectory, "seed.sql"),
    "--schema",
    baselineSchemaPath,
  ]);
  await runPrisma("Frozen baseline assertions", [
    "db",
    "execute",
    "--file",
    join(fixtureDirectory, "assert-baseline.sql"),
    "--schema",
    baselineSchemaPath,
  ]);

  await runPrisma("Upgrade migration deploy", [
    "migrate",
    "deploy",
    "--schema",
    join(rootDirectory, "prisma/schema.prisma"),
  ]);
  await runPrisma("Upgrade migration status", [
    "migrate",
    "status",
    "--schema",
    join(rootDirectory, "prisma/schema.prisma"),
  ]);
  await runPrisma("Post-upgrade assertions", [
    "db",
    "execute",
    "--file",
    join(fixtureDirectory, "assert-after-upgrade.sql"),
    "--schema",
    join(rootDirectory, "prisma/schema.prisma"),
  ]);

  console.log(
    `upgrade baseline passed (${manifest.migrations.length} frozen migrations)`,
  );
} finally {
  if (schemaCreated) {
    try {
      await admin.$executeRawUnsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
    } catch {
      process.exitCode = 1;
    }
  }
  await admin.$disconnect();
  await rm(temporaryDirectory, { recursive: true, force: true });
}

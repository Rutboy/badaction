import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = resolve(repositoryRoot, "deploy/install.sh");
const managerPath = resolve(repositoryRoot, "deploy/manage.sh");

const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    ...options,
  });

test("installer and management scripts have valid Bash syntax", () => {
  for (const script of [installerPath, managerPath]) {
    const result = run("bash", ["-n", script]);
    assert.equal(result.status, 0, result.stderr);
  }
});

test("installer help and dry-run do not require root or change the host", () => {
  const help = run("bash", [installerPath, "--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(
    help.stdout,
    /never overwrites an existing production environment file/u,
  );

  const dryRun = run("bash", [
    installerPath,
    "--dry-run",
    "--yes",
    "--domain",
    "Retro.Example.COM.",
    "--email",
    "operator@example.com",
  ]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /https:\/\/retro\.example\.com/u);
  assert.match(dryRun.stdout, /No files or services were changed/u);
});

test("installer rejects unsafe domain and email input", () => {
  for (const domain of [
    "localhost",
    "127.0.0.1",
    "https://retro.example.com",
    "retro.example.com/path",
    "bad_name.example.com",
  ]) {
    const result = run("bash", [
      installerPath,
      "--dry-run",
      "--yes",
      "--domain",
      domain,
      "--email",
      "operator@example.com",
    ]);
    assert.notEqual(result.status, 0, `accepted invalid domain: ${domain}`);
    assert.doesNotMatch(result.stdout + result.stderr, /DOCKER_.*SECRET=/u);
  }

  const invalidEmail = run("bash", [
    installerPath,
    "--dry-run",
    "--yes",
    "--domain",
    "retro.example.com",
    "--email",
    "not-an-email",
  ]);
  assert.notEqual(invalidEmail.status, 0);

  const interpolationEmail = run("bash", [
    installerPath,
    "--dry-run",
    "--yes",
    "--domain",
    "retro.example.com",
    "--email",
    "operator$variable@example.com",
  ]);
  assert.notEqual(interpolationEmail.status, 0);
});

test("generated production environment is private, complete, and never overwritten", (t) => {
  const temporaryDirectory = mkdtempSync(
    resolve(tmpdir(), "badaction-install-test-"),
  );
  const environmentPath = resolve(temporaryDirectory, ".env.production");
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const generate = run("bash", [
    "-c",
    'source "$1"; DOMAIN="retro.example.com"; ACME_EMAIL="operator@example.com"; generate_environment "$2"',
    "installer-test",
    installerPath,
    environmentPath,
  ]);
  assert.equal(generate.status, 0, generate.stderr);
  assert.equal(generate.stdout, "");
  assert.equal(statSync(environmentPath).mode & 0o777, 0o600);

  const contents = readFileSync(environmentPath, "utf8");
  const environment = parseEnv(contents);
  assert.equal(environment.BADACTION_INSTALLER_MANAGED, "1");
  assert.equal(environment.BADACTION_DOMAIN, "retro.example.com");
  assert.equal(environment.CADDY_ACME_EMAIL, "operator@example.com");
  assert.equal(environment.DOCKER_APP_ORIGIN, "https://retro.example.com");
  assert.equal(environment.TRUSTED_PROXY_HOPS, "1");

  const databasePasswords = [
    environment.POSTGRES_PASSWORD,
    environment.POSTGRES_MIGRATOR_PASSWORD,
    environment.POSTGRES_RUNTIME_PASSWORD,
  ];
  const applicationSecrets = [
    environment.DOCKER_VISITOR_TOKEN_SECRET,
    environment.DOCKER_BOARD_ACCESS_SECRET,
    environment.DOCKER_RATE_LIMIT_KEY_SECRET,
  ];
  for (const secret of [...databasePasswords, ...applicationSecrets]) {
    assert.match(secret, /^[a-f\d]{64}$/u);
  }
  assert.equal(new Set(databasePasswords).size, 3);
  assert.equal(new Set(applicationSecrets).size, 3);
  assert.equal(new Set([...databasePasswords, ...applicationSecrets]).size, 6);
  assert.equal(
    environment.DOCKER_MIGRATOR_DATABASE_URL,
    `postgresql://badaction_migrator:${environment.POSTGRES_MIGRATOR_PASSWORD}@postgres:5432/retro?schema=public`,
  );
  assert.equal(
    environment.DOCKER_RUNTIME_DATABASE_URL,
    `postgresql://badaction_app:${environment.POSTGRES_RUNTIME_PASSWORD}@postgres:5432/retro?schema=public`,
  );

  const generateAgain = run("bash", [
    "-c",
    'source "$1"; DOMAIN="retro.example.com"; ACME_EMAIL="operator@example.com"; generate_environment "$2"',
    "installer-test",
    installerPath,
    environmentPath,
  ]);
  assert.notEqual(generateAgain.status, 0);
  assert.equal(readFileSync(environmentPath, "utf8"), contents);
});

test("existing installer environment validates without exposing its secrets", (t) => {
  const temporaryDirectory = mkdtempSync(
    resolve(tmpdir(), "badaction-existing-env-test-"),
  );
  const environmentPath = resolve(temporaryDirectory, ".env.production");
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  const result = run("bash", [
    "-c",
    'source "$1"; DOMAIN="retro.example.com"; ACME_EMAIL="operator@example.com"; generate_environment "$2"; DOMAIN="RETRO.EXAMPLE.COM."; ACME_EMAIL="operator@example.com"; validate_existing_environment "$2"',
    "installer-test",
    installerPath,
    environmentPath,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.doesNotMatch(result.stderr, /POSTGRES_PASSWORD=/u);
});

test("management helper documents the safe operator commands", () => {
  const result = run("bash", [managerPath, "--help"]);
  assert.equal(result.status, 0, result.stderr);
  for (const command of [
    "doctor",
    "status",
    "logs",
    "backup",
    "start",
    "stop",
    "restart",
  ]) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`, "u"));
  }
});

test("management backup verifies its dump and removes a failed partial file", (t) => {
  const temporaryDirectory = mkdtempSync(
    resolve(tmpdir(), "badaction-backup-test-"),
  );
  const fakeBinDirectory = resolve(temporaryDirectory, "bin");
  const fakeDockerPath = resolve(fakeBinDirectory, "docker");
  const environmentPath = resolve(temporaryDirectory, "production.env");
  const backupPath = resolve(temporaryDirectory, "verified.dump");
  const failedBackupPath = resolve(temporaryDirectory, "failed.dump");
  t.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

  mkdirSync(fakeBinDirectory);
  writeFileSync(
    environmentPath,
    "BADACTION_INSTALLER_MANAGED=1\nBADACTION_DOMAIN=retro.example.com\nAPP_PORT=3000\n",
    { mode: 0o600 },
  );
  writeFileSync(
    fakeDockerPath,
    `#!/usr/bin/env bash
set -eu
case "$*" in
  "compose version" | "info") exit 0 ;;
  *pg_dump*) printf 'synthetic-custom-format-dump' ;;
  *pg_restore*)
    cat >/dev/null
    [[ "\${FAIL_BACKUP_VERIFICATION:-0}" != "1" ]]
    ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(fakeDockerPath, 0o755);

  const environment = {
    ...process.env,
    BADACTION_ENV_FILE: environmentPath,
    PATH: `${fakeBinDirectory}:${process.env.PATH}`,
  };
  const successfulBackup = run("bash", [managerPath, "backup", backupPath], {
    env: environment,
  });
  assert.equal(successfulBackup.status, 0, successfulBackup.stderr);
  assert.equal(
    readFileSync(backupPath, "utf8"),
    "synthetic-custom-format-dump",
  );
  assert.equal(statSync(backupPath).mode & 0o777, 0o600);

  const failedBackup = run("bash", [managerPath, "backup", failedBackupPath], {
    env: { ...environment, FAIL_BACKUP_VERIFICATION: "1" },
  });
  assert.notEqual(failedBackup.status, 0);
  assert.equal(existsSync(failedBackupPath), false);
  assert.equal(existsSync(`${failedBackupPath}.partial`), false);
});

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { removeStandaloneEnvironmentFiles } from "./prepare-standalone-licenses.mjs";

test("removes standalone environment files without deleting unrelated dotfiles", () => {
  const fixture = mkdtempSync(join(tmpdir(), "badaction-standalone-env-"));
  try {
    for (const name of [".env", ".env.local", ".env.production"]) {
      writeFileSync(join(fixture, name), "SENTINEL=must-not-ship\n");
    }
    writeFileSync(join(fixture, ".gitkeep"), "");

    removeStandaloneEnvironmentFiles(fixture);

    for (const name of [".env", ".env.local", ".env.production"]) {
      assert.equal(existsSync(join(fixture, name)), false);
    }
    assert.equal(existsSync(join(fixture, ".gitkeep")), true);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

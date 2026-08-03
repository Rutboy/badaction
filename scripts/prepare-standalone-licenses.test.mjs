import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  listRuntimePackages,
  removeStandaloneEnvironmentFiles,
} from "./prepare-standalone-licenses.mjs";

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

test("resolves notice sources by install path for aliased runtime packages", () => {
  const fixture = mkdtempSync(join(tmpdir(), "badaction-runtime-alias-"));
  try {
    const runtimePackage = join(
      fixture,
      "standalone",
      "node_modules",
      "typescript",
    );
    const sourceNodeModules = join(fixture, "source-node_modules");
    mkdirSync(runtimePackage, { recursive: true });
    writeFileSync(
      join(runtimePackage, "package.json"),
      `${JSON.stringify({
        name: "@typescript/typescript6",
        version: "6.0.2",
        license: "Apache-2.0",
      })}\n`,
    );

    assert.deepEqual(
      listRuntimePackages({
        root: join(fixture, "standalone"),
        sourceNodeModules,
      }),
      [
        {
          name: "@typescript/typescript6",
          version: "6.0.2",
          license: "Apache-2.0",
          sourceDirectory: join(sourceNodeModules, "typescript"),
        },
      ],
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

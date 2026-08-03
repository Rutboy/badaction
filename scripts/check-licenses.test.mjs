import assert from "node:assert/strict";
import test from "node:test";
import { auditLockfile } from "./check-licenses.mjs";

const policy = {
  projectLicense: "MIT",
  allowedLicenses: ["MIT", "Apache-2.0"],
  reviewedExceptions: [
    {
      packages: ["optional-native-linux"],
      licenses: ["LGPL-3.0-or-later"],
      optionalOnly: true,
      reason: "reviewed test fixture",
    },
    {
      packages: ["excluded-missing-license"],
      versions: ["1.0.0"],
      lockfileLicenseMissing: true,
      verifiedLicense: "MIT",
      artifactExcluded: true,
      reason: "reviewed excluded fixture",
    },
  ],
};

const manifest = { license: "MIT" };

test("accepts allowlisted licenses and constrained reviewed exceptions", () => {
  const result = auditLockfile({
    manifest,
    policy,
    lockfile: {
      packages: {
        "": { license: "MIT" },
        "node_modules/allowed": { version: "1.0.0", license: "MIT" },
        "node_modules/optional-native-linux": {
          version: "2.0.0",
          license: "LGPL-3.0-or-later",
          optional: true,
        },
        "node_modules/excluded-missing-license": { version: "1.0.0" },
      },
    },
  });

  assert.deepEqual(result.errors, []);
  assert.equal(result.packageCount, 3);
  assert.equal(result.reviewed.length, 2);
});

test("rejects missing and non-allowlisted dependency licenses", () => {
  const result = auditLockfile({
    manifest,
    policy,
    lockfile: {
      packages: {
        "": { license: "MIT" },
        "node_modules/missing": { version: "1.0.0" },
        "node_modules/copyleft": { version: "1.0.0", license: "GPL-3.0-only" },
      },
    },
  });

  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /missing SPDX license/);
  assert.match(result.errors[1], /not allowlisted/);
});

test("does not accept a reviewed exception outside its constraints", () => {
  const result = auditLockfile({
    manifest,
    policy,
    lockfile: {
      packages: {
        "": { license: "MIT" },
        "node_modules/optional-native-linux": {
          version: "2.0.0",
          license: "LGPL-3.0-or-later",
          optional: false,
        },
        "node_modules/excluded-missing-license": { version: "2.0.0" },
      },
    },
  });

  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /not allowlisted/);
  assert.match(result.errors[1], /missing SPDX license/);
});

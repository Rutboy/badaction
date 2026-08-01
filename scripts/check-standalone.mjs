import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  listProductionPackages,
  listRuntimePackages,
  listNextCompiledNoticePaths,
  nextCompiledNoticeDirectory,
  productionLicenseDirectory,
  productionPackageOutputName,
  runtimeLicenseDirectory,
} from "./prepare-standalone-licenses.mjs";

const standaloneRoot = resolve(".next/standalone");
const serverEntry = resolve(standaloneRoot, "server.js");
const instrumentationEntry = resolve(
  standaloneRoot,
  ".next/server/instrumentation.js",
);
const sharpPackage = resolve(standaloneRoot, "node_modules/sharp");
const imagePackages = resolve(standaloneRoot, "node_modules/@img");

const errors = [];
if (!existsSync(serverEntry)) {
  errors.push(".next/standalone/server.js is missing");
}
if (
  existsSync(standaloneRoot) &&
  readdirSync(standaloneRoot).some(
    (name) => name === ".env" || name.startsWith(".env."),
  )
) {
  errors.push("environment file is present in the standalone artifact");
}
if (!existsSync(instrumentationEntry)) {
  errors.push("standalone instrumentation entry is missing");
} else if (
  readFileSync(instrumentationEntry, "utf8").includes("NEXT_RUNTIME")
) {
  errors.push(
    "standalone instrumentation retained a runtime NEXT_RUNTIME lookup",
  );
}
if (existsSync(sharpPackage)) {
  errors.push("optional sharp package is present in the standalone artifact");
}
if (
  existsSync(imagePackages) &&
  readdirSync(imagePackages).some((name) => name.startsWith("sharp-"))
) {
  errors.push(
    "optional @img/sharp-* package is present in the standalone artifact",
  );
}

for (const requiredFile of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
  if (!existsSync(resolve(standaloneRoot, requiredFile))) {
    errors.push(`${requiredFile} is missing from the standalone artifact`);
  }
}

const runtimeLicenseManifest = resolve(
  runtimeLicenseDirectory,
  "manifest.json",
);
if (!existsSync(runtimeLicenseManifest)) {
  errors.push("standalone runtime license manifest is missing");
} else {
  const manifest = JSON.parse(readFileSync(runtimeLicenseManifest, "utf8"));
  const runtimePackages = listRuntimePackages();
  const licensedPackages = new Set(
    manifest.packages.map(({ name, version }) => `${name}@${version}`),
  );
  if (licensedPackages.size !== runtimePackages.length) {
    errors.push(
      "runtime license manifest package count does not match artifact",
    );
  }
  for (const runtimePackage of runtimePackages) {
    const identifier = `${runtimePackage.name}@${runtimePackage.version}`;
    if (!licensedPackages.has(identifier)) {
      errors.push(`${identifier} is missing from the runtime license manifest`);
    }
  }
  for (const runtimePackage of manifest.packages) {
    const outputName = runtimePackage.name
      .replace(/^@/, "")
      .replaceAll("/", "__");
    if (
      !Array.isArray(runtimePackage.notices) ||
      runtimePackage.notices.length === 0
    ) {
      errors.push(`${runtimePackage.name} has no runtime license notice`);
      continue;
    }
    for (const notice of runtimePackage.notices) {
      if (!existsSync(resolve(runtimeLicenseDirectory, outputName, notice))) {
        errors.push(
          `${runtimePackage.name} runtime notice ${notice} is missing`,
        );
      }
    }
  }

  const productionPackages = listProductionPackages();
  const licensedProductionPackages = new Map(
    (manifest.productionPackages ?? []).map((dependency) => [
      `${dependency.name}@${dependency.version}`,
      dependency,
    ]),
  );
  if (licensedProductionPackages.size !== productionPackages.length) {
    errors.push(
      "production license manifest package count does not match the lockfile closure",
    );
  }
  for (const productionPackage of productionPackages) {
    const identifier = `${productionPackage.name}@${productionPackage.version}`;
    const licensedPackage = licensedProductionPackages.get(identifier);
    if (!licensedPackage) {
      errors.push(
        `${identifier} is missing from the production license manifest`,
      );
      continue;
    }
    if (
      !Array.isArray(licensedPackage.notices) ||
      licensedPackage.notices.length === 0
    ) {
      errors.push(`${identifier} has no production license notice`);
      continue;
    }
    for (const notice of licensedPackage.notices) {
      if (
        !existsSync(
          resolve(
            productionLicenseDirectory,
            productionPackageOutputName(productionPackage),
            notice,
          ),
        )
      ) {
        errors.push(`${identifier} production notice ${notice} is missing`);
      }
    }
  }

  const expectedNextCompiledNotices = listNextCompiledNoticePaths();
  const bundledNextCompiledNotices =
    manifest.bundledNotices?.nextCompiled?.notices;
  if (
    !Array.isArray(bundledNextCompiledNotices) ||
    bundledNextCompiledNotices.length !== expectedNextCompiledNotices.length ||
    bundledNextCompiledNotices.some(
      (notice, index) => notice !== expectedNextCompiledNotices[index],
    )
  ) {
    errors.push(
      "Next.js compiled notice manifest does not match the source package",
    );
  } else {
    for (const notice of bundledNextCompiledNotices) {
      if (!existsSync(resolve(nextCompiledNoticeDirectory, notice))) {
        errors.push(`Next.js compiled notice ${notice} is missing`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error("Standalone artifact check failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log("Standalone artifact check passed");
}

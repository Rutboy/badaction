import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const standaloneRoot = resolve(".next/standalone");
export const runtimeLicenseDirectory = resolve(
  standaloneRoot,
  "third-party-licenses",
);
export const nextCompiledNoticeDirectory = resolve(
  runtimeLicenseDirectory,
  "next-compiled",
);
export const productionLicenseDirectory = resolve(
  runtimeLicenseDirectory,
  "production-packages",
);
const nextCompiledSourceDirectory = resolve(
  "node_modules",
  "next",
  "dist",
  "compiled",
);

// These package tarballs omit the full notice. Keep the reviewed fallback list
// explicit so a newly introduced package still fails closed.
const radixPackagesUsingMonorepoLicense = [
  "@radix-ui/react-compose-refs",
  "@radix-ui/react-context",
  "@radix-ui/react-direction",
  "@radix-ui/react-id",
  "@radix-ui/react-use-callback-ref",
  "@radix-ui/react-use-escape-keydown",
  "@radix-ui/react-use-layout-effect",
  "@radix-ui/react-use-rect",
  "@radix-ui/react-use-size",
  "@radix-ui/rect",
];

const fallbackLicenseSources = new Map([
  ["@next/env", { packageName: "next", file: "license.md" }],
  ["client-only", { packageName: "react", file: "LICENSE" }],
  [
    "@prisma/dev",
    {
      sourcePath: "third-party-licenses/prisma-dev.LICENSE",
      destinationName: "LICENSE-from-package-metadata",
    },
  ],
  [
    "remeda",
    {
      sourcePath: "third-party-licenses/remeda.LICENSE",
      destinationName: "LICENSE-from-upstream-repository",
    },
  ],
  [
    "react-remove-scroll-bar",
    {
      sourcePath: "third-party-licenses/react-remove-scroll-bar.LICENSE",
      destinationName: "LICENSE-from-upstream-repository",
    },
  ],
  ...radixPackagesUsingMonorepoLicense.map((packageName) => [
    packageName,
    { packageName: "@radix-ui/react-dialog", file: "LICENSE" },
  ]),
]);

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const isNoticeFile = (name) =>
  /^(?:licen[sc]e|copying|notice)(?:\..*)?$/i.test(name);
const packageOutputName = (name) =>
  name.replace(/^@/, "").replaceAll("/", "__");
const packageNameFromLockPath = (packagePath) => {
  const relativeName = packagePath.slice(
    packagePath.lastIndexOf("node_modules/") + "node_modules/".length,
  );
  const segments = relativeName.split("/");
  return relativeName.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
};
export const productionPackageOutputName = ({ name, version }) =>
  `${packageOutputName(name)}@${version}`.replaceAll(/[^A-Za-z0-9._@-]/g, "_");
const isEnvironmentFile = (name) => name === ".env" || name.startsWith(".env.");

const collectNoticePaths = (directory, paths = []) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      collectNoticePaths(path, paths);
    } else if (entry.isFile() && isNoticeFile(entry.name)) {
      paths.push(
        relative(nextCompiledSourceDirectory, path).replaceAll("\\", "/"),
      );
    }
  }
  return paths;
};

export const listNextCompiledNoticePaths = () => {
  if (!existsSync(nextCompiledSourceDirectory)) {
    return [];
  }
  return collectNoticePaths(nextCompiledSourceDirectory).sort();
};

const copyNextCompiledNotices = () => {
  const notices = listNextCompiledNoticePaths();
  if (notices.length === 0) {
    throw new Error("Next.js compiled dependency notices are missing");
  }
  for (const notice of notices) {
    const destination = resolve(nextCompiledNoticeDirectory, notice);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(resolve(nextCompiledSourceDirectory, notice), destination);
  }
  return notices;
};

export const removeStandaloneEnvironmentFiles = (root = standaloneRoot) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (isEnvironmentFile(entry.name)) {
      rmSync(resolve(root, entry.name), {
        recursive: true,
        force: true,
      });
    }
  }
};

export const listRuntimePackages = ({
  root = standaloneRoot,
  sourceNodeModules = resolve("node_modules"),
} = {}) => {
  const nodeModules = resolve(root, "node_modules");
  if (!existsSync(nodeModules)) {
    return [];
  }

  const packageDirectories = [];
  for (const entry of readdirSync(nodeModules, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }
    if (entry.name.startsWith("@")) {
      const scope = resolve(nodeModules, entry.name);
      for (const scopedEntry of readdirSync(scope, { withFileTypes: true })) {
        if (scopedEntry.isDirectory()) {
          packageDirectories.push(resolve(scope, scopedEntry.name));
        }
      }
    } else {
      packageDirectories.push(resolve(nodeModules, entry.name));
    }
  }

  return packageDirectories
    .filter((directory) => existsSync(resolve(directory, "package.json")))
    .map((directory) => {
      const metadata = readJson(resolve(directory, "package.json"));
      return {
        name: metadata.name,
        version: metadata.version,
        license: metadata.license,
        sourceDirectory: resolve(
          sourceNodeModules,
          relative(nodeModules, directory),
        ),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const listProductionPackages = () => {
  const lockfile = readJson(resolve("package-lock.json"));
  const policy = readJson(resolve("license-policy.json"));
  const artifactExcludedPackages = new Set(
    policy.reviewedExceptions
      .filter((exception) => exception.artifactExcluded === true)
      .flatMap((exception) => exception.packages),
  );
  const packages = new Map();
  for (const [packagePath, lockMetadata] of Object.entries(
    lockfile.packages ?? {},
  )) {
    if (
      packagePath === "" ||
      lockMetadata.link === true ||
      lockMetadata.dev === true ||
      lockMetadata.devOptional === true ||
      lockMetadata.optional === true
    ) {
      continue;
    }
    const packageName = packageNameFromLockPath(packagePath);
    if (artifactExcludedPackages.has(packageName)) {
      continue;
    }
    const sourceDirectory = resolve(packagePath);
    const metadataPath = resolve(sourceDirectory, "package.json");
    if (!existsSync(metadataPath)) {
      throw new Error(
        `Installed production package is missing: ${packagePath}`,
      );
    }
    const metadata = readJson(metadataPath);
    const identifier = `${metadata.name}@${metadata.version}`;
    if (!packages.has(identifier)) {
      packages.set(identifier, {
        name: metadata.name,
        version: metadata.version,
        license: metadata.license,
        sourceDirectory,
      });
    }
  }
  return [...packages.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.version.localeCompare(right.version),
  );
};

const extractReadmeLicense = (sourceDirectory) => {
  const readme = resolve(sourceDirectory, "README.md");
  if (!existsSync(readme)) {
    return null;
  }
  const text = readFileSync(readme, "utf8");
  const match = text.match(/^## license\s*$([\s\S]*)/im);
  return match?.[1]?.trim() || null;
};

const collectPackageNotices = (
  runtimePackage,
  outputDirectory,
  sourceDirectory = resolve("node_modules", runtimePackage.name),
) => {
  const sourceFiles = existsSync(sourceDirectory)
    ? readdirSync(sourceDirectory).filter(isNoticeFile).sort()
    : [];
  const copiedFiles = [];

  for (const sourceFile of sourceFiles) {
    copyFileSync(
      resolve(sourceDirectory, sourceFile),
      resolve(outputDirectory, sourceFile),
    );
    copiedFiles.push(sourceFile);
  }

  if (copiedFiles.length > 0) {
    return copiedFiles;
  }

  const fallback =
    fallbackLicenseSources.get(runtimePackage.name) ??
    (runtimePackage.name.startsWith("@next/")
      ? { packageName: "next", file: "license.md" }
      : undefined);
  if (fallback) {
    const source = fallback.sourcePath
      ? resolve(fallback.sourcePath)
      : resolve("node_modules", fallback.packageName, fallback.file);
    if (existsSync(source)) {
      const destinationName =
        fallback.destinationName ??
        `LICENSE-from-${packageOutputName(fallback.packageName)}-${basename(fallback.file)}`;
      copyFileSync(source, resolve(outputDirectory, destinationName));
      return [destinationName];
    }
  }

  const readmeLicense = extractReadmeLicense(sourceDirectory);
  if (readmeLicense) {
    const destinationName = "LICENSE-from-README.txt";
    writeFileSync(
      resolve(outputDirectory, destinationName),
      `${readmeLicense}\n`,
    );
    return [destinationName];
  }

  return [];
};

export const prepareStandaloneLicenses = () => {
  if (!existsSync(resolve(standaloneRoot, "server.js"))) {
    throw new Error(".next/standalone/server.js is missing");
  }

  removeStandaloneEnvironmentFiles();
  rmSync(runtimeLicenseDirectory, { recursive: true, force: true });
  mkdirSync(runtimeLicenseDirectory, { recursive: true });

  const manifest = [];
  const missing = [];
  for (const runtimePackage of listRuntimePackages()) {
    const { sourceDirectory, ...runtimePackageMetadata } = runtimePackage;
    const outputDirectory = resolve(
      runtimeLicenseDirectory,
      packageOutputName(runtimePackage.name),
    );
    mkdirSync(outputDirectory, { recursive: true });
    const notices = collectPackageNotices(
      runtimePackage,
      outputDirectory,
      sourceDirectory,
    );
    if (notices.length === 0) {
      missing.push(`${runtimePackage.name}@${runtimePackage.version}`);
      continue;
    }
    manifest.push({ ...runtimePackageMetadata, notices });
  }

  if (missing.length > 0) {
    throw new Error(
      `Runtime packages without license notices: ${missing.join(", ")}`,
    );
  }

  const nextCompiledNotices = copyNextCompiledNotices();

  const productionPackages = [];
  const missingProductionNotices = [];
  for (const productionPackage of listProductionPackages()) {
    const outputDirectory = resolve(
      productionLicenseDirectory,
      productionPackageOutputName(productionPackage),
    );
    mkdirSync(outputDirectory, { recursive: true });
    const notices = collectPackageNotices(
      productionPackage,
      outputDirectory,
      productionPackage.sourceDirectory,
    );
    if (notices.length === 0) {
      missingProductionNotices.push(
        `${productionPackage.name}@${productionPackage.version}`,
      );
      continue;
    }
    productionPackages.push({
      name: productionPackage.name,
      version: productionPackage.version,
      license: productionPackage.license,
      notices,
    });
  }
  if (missingProductionNotices.length > 0) {
    throw new Error(
      `Production packages without license notices: ${missingProductionNotices.join(", ")}`,
    );
  }

  copyFileSync(resolve("LICENSE"), resolve(standaloneRoot, "LICENSE"));
  copyFileSync(
    resolve("THIRD_PARTY_NOTICES.md"),
    resolve(standaloneRoot, "THIRD_PARTY_NOTICES.md"),
  );
  writeFileSync(
    resolve(runtimeLicenseDirectory, "manifest.json"),
    `${JSON.stringify(
      {
        packages: manifest,
        productionPackages,
        bundledNotices: {
          nextCompiled: {
            source: "next/dist/compiled",
            notices: nextCompiledNotices,
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `Prepared standalone license bundle (${manifest.length} external runtime packages, ${productionPackages.length} production packages, ${nextCompiledNotices.length} Next.js compiled notices)`,
  );
};

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  prepareStandaloneLicenses();
}

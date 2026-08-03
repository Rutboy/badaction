import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const packageNameFromLockPath = (packagePath) => {
  const marker = "node_modules/";
  const markerIndex = packagePath.lastIndexOf(marker);
  const relativeName =
    markerIndex === -1
      ? packagePath
      : packagePath.slice(markerIndex + marker.length);
  const segments = relativeName.split("/");
  return relativeName.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
};

const findReviewedException = ({ packageName, metadata, policy }) =>
  policy.reviewedExceptions.find((exception) => {
    if (!exception.packages.includes(packageName)) {
      return false;
    }
    if (exception.versions && !exception.versions.includes(metadata.version)) {
      return false;
    }
    if (exception.lockfileLicenseMissing === true) {
      if (
        exception.artifactExcluded !== true ||
        !exception.versions ||
        typeof exception.verifiedLicense !== "string" ||
        typeof metadata.license === "string"
      ) {
        return false;
      }
    } else if (!exception.licenses?.includes(metadata.license)) {
      return false;
    }
    if (exception.artifactExcluded === true && !exception.versions) {
      return false;
    }
    if (exception.devOnly && metadata.dev !== true) {
      return false;
    }
    if (exception.optionalOnly && metadata.optional !== true) {
      return false;
    }
    return true;
  });

export const auditLockfile = ({ lockfile, manifest, policy }) => {
  const errors = [];
  const reviewed = [];
  const licenseCounts = new Map();

  if (manifest.license !== policy.projectLicense) {
    errors.push(
      `package.json license must be ${policy.projectLicense}, received ${String(manifest.license)}`,
    );
  }
  if (!lockfile.packages || typeof lockfile.packages !== "object") {
    errors.push("package-lock.json must contain npm packages metadata");
    return { errors, reviewed, licenseCounts, packageCount: 0 };
  }
  if (lockfile.packages[""]?.license !== policy.projectLicense) {
    errors.push(
      `package-lock.json root license must be ${policy.projectLicense}`,
    );
  }

  const allowedLicenses = new Set(policy.allowedLicenses);
  let packageCount = 0;

  for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
    if (packagePath === "" || metadata.link === true) {
      continue;
    }
    packageCount += 1;
    const packageName = packageNameFromLockPath(packagePath);
    const exception = findReviewedException({ packageName, metadata, policy });
    if (typeof metadata.license !== "string" || metadata.license.length === 0) {
      if (!exception) {
        errors.push(
          `${packageName}@${metadata.version ?? "unknown"}: missing SPDX license`,
        );
        continue;
      }
      reviewed.push({
        packageName,
        version: metadata.version ?? "unknown",
        license: `${exception.verifiedLicense} (verified; lockfile metadata missing)`,
        reason: exception.reason,
      });
      continue;
    }

    licenseCounts.set(
      metadata.license,
      (licenseCounts.get(metadata.license) ?? 0) + 1,
    );
    if (allowedLicenses.has(metadata.license)) {
      continue;
    }

    if (!exception) {
      errors.push(
        `${packageName}@${metadata.version ?? "unknown"}: ${metadata.license} is not allowlisted`,
      );
      continue;
    }
    reviewed.push({
      packageName,
      version: metadata.version ?? "unknown",
      license: metadata.license,
      reason: exception.reason,
    });
  }

  return { errors, reviewed, licenseCounts, packageCount };
};

const run = () => {
  const manifest = readJson(resolve("package.json"));
  const lockfile = readJson(resolve("package-lock.json"));
  const policy = readJson(resolve("license-policy.json"));
  const result = auditLockfile({ lockfile, manifest, policy });

  if (result.errors.length > 0) {
    console.error("Dependency license check failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  const summary = [...result.licenseCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([license, count]) => `${license}: ${count}`)
    .join(", ");
  console.log(
    `Dependency license check passed (${result.packageCount} lockfile packages)`,
  );
  console.log(`Licenses: ${summary}`);
  if (result.reviewed.length > 0) {
    console.log(`Reviewed exceptions: ${result.reviewed.length}`);
    for (const dependency of result.reviewed) {
      console.log(
        `- ${dependency.packageName}@${dependency.version}: ${dependency.license} — ${dependency.reason}`,
      );
    }
  }
};

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  run();
}

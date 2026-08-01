import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => {
    const absolutePath = resolve(repositoryRoot, file);
    return existsSync(absolutePath) && statSync(absolutePath).isFile();
  });

const generatedDirectoryNames = new Set([
  ".next",
  "node_modules",
  "out",
  "dist",
  "build",
  "coverage",
  "playwright-report",
  "test-results",
]);
const blockedFiles = [];

const isEnvironmentFileName = (basename) => {
  if (basename === ".env.example" || basename.endsWith(".env.example")) {
    return false;
  }
  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename.endsWith(".env") ||
    basename.includes(".env.")
  );
};

for (const file of repositoryFiles) {
  const pathParts = file.split("/");
  const basename = pathParts.at(-1);

  if (
    pathParts.some((part) => generatedDirectoryNames.has(part)) ||
    file.endsWith(".tsbuildinfo") ||
    file.endsWith(".log") ||
    file.endsWith(".lcov") ||
    basename === ".DS_Store" ||
    basename === ".envrc" ||
    pathParts.includes(".direnv") ||
    /\.(?:db|dump|sqlite3?|tgz|zip|p12|pfx|key)$/iu.test(file) ||
    /(?:^|\/)(?:backup|database|dump)[^/]*\.(?:bak|sql(?:\.gz)?)$/iu.test(file)
  ) {
    blockedFiles.push(`${file} (generated or local artifact)`);
  }

  if (isEnvironmentFileName(basename)) {
    blockedFiles.push(`${file} (local environment file)`);
  }

  if (file === "docs.local" || file.startsWith("docs.local/")) {
    blockedFiles.push(`${file} (internal documentation)`);
  }
}

const workflowFiles = repositoryFiles.filter(
  (file) =>
    (/^\.github\/workflows\/.*\.ya?ml$/u.test(file) ||
      /^\.github\/actions\/.*\/action\.ya?ml$/u.test(file)) &&
    existsSync(resolve(repositoryRoot, file)),
);
const unpinnedActions = [];

for (const file of workflowFiles) {
  const contents = readFileSync(resolve(repositoryRoot, file), "utf8");
  const usesPattern = /^\s*uses:\s*["']?([^\s"'#]+)["']?/gmu;

  for (const match of contents.matchAll(usesPattern)) {
    const reference = match[1];
    if (reference.startsWith("./")) {
      continue;
    }

    const pinned = reference.startsWith("docker://")
      ? /@sha256:[a-f\d]{64}$/iu.test(reference)
      : /@[a-f\d]{40}$/iu.test(reference);
    if (!pinned) {
      const line = contents.slice(0, match.index).split("\n").length;
      unpinnedActions.push(`${file}:${line}: ${reference}`);
    }
  }
}

const unpinnedContainerImages = [];
for (const file of repositoryFiles) {
  const contents = readFileSync(resolve(repositoryRoot, file), "utf8");
  const lines = contents.split("\n");

  if (/(?:^|\/)Dockerfile(?:\..*)?$/u.test(file)) {
    const stageNames = new Set(
      lines
        .map((line) => line.match(/^\s*FROM\s+.+\s+AS\s+(\S+)\s*$/iu)?.[1])
        .filter(Boolean),
    );
    lines.forEach((line, index) => {
      const image = line.match(
        /^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)(?:\s+AS\s+\S+)?\s*$/iu,
      )?.[1];
      if (
        image &&
        image !== "scratch" &&
        !stageNames.has(image) &&
        !/@sha256:[a-f\d]{64}$/iu.test(image)
      ) {
        unpinnedContainerImages.push(`${file}:${index + 1}: ${image}`);
      }
    });
  }

  if (/\.ya?ml$/u.test(file)) {
    lines.forEach((line, index) => {
      const image = line.match(/^\s*image:\s*["']?([^\s"']+)/u)?.[1];
      if (
        image &&
        !image.includes("${") &&
        !/@sha256:[a-f\d]{64}$/iu.test(image)
      ) {
        unpinnedContainerImages.push(`${file}:${index + 1}: ${image}`);
      }
    });
  }
}

if (
  blockedFiles.length > 0 ||
  unpinnedActions.length > 0 ||
  unpinnedContainerImages.length > 0
) {
  console.error("Repository hygiene check failed:");

  if (blockedFiles.length > 0) {
    console.error("Tracked generated, private, or local files:");
    for (const file of [...new Set(blockedFiles)].sort()) {
      console.error(`- ${file}`);
    }
  }

  if (unpinnedActions.length > 0) {
    console.error("GitHub Actions must use a full commit SHA or image digest:");
    for (const action of unpinnedActions.sort()) {
      console.error(`- ${action}`);
    }
  }

  if (unpinnedContainerImages.length > 0) {
    console.error("Literal container images must use a sha256 digest:");
    for (const image of unpinnedContainerImages.sort()) {
      console.error(`- ${image}`);
    }
  }

  process.exitCode = 1;
} else {
  console.log("Repository hygiene check passed");
}

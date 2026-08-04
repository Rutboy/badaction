import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const gitFiles = (args) =>
  execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

const isExistingFile = (file) => {
  const absolutePath = resolve(repositoryRoot, file);
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
};

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

const trackedFiles = gitFiles(["ls-files", "-z"]);
const trackedExistingFiles = trackedFiles.filter(isExistingFile);
const repositoryFiles = [
  ...new Set(
    gitFiles([
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ]).filter(isExistingFile),
  ),
];
const trackedExistingSet = new Set(trackedExistingFiles);
const errors = [];

const documentationPages = [
  "README.md",
  "quick-start.md",
  "getting-started.md",
  "deployment.md",
  "configuration.md",
  "architecture.md",
  "operations.md",
  "troubleshooting.md",
  "security-and-privacy.md",
  "development.md",
  "api.md",
];

const requiredFiles = [
  "README.md",
  "README.ru.md",
  "README.es.md",
  ...documentationPages.map((page) => `docs/${page}`),
  ...documentationPages.map((page) => `docs/ru/${page}`),
  ...documentationPages.map((page) => `docs/es/${page}`),
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "third-party-licenses/react-remove-scroll-bar.LICENSE",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.production.yml",
  "docker-compose.quick-start.yml",
  "deploy/production.env.example",
  "deploy/init-production-db.sh",
  "deploy/install.sh",
  "deploy/manage.sh",
  "deploy/caddy/Caddyfile",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "SUPPORT.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/dependabot.yml",
];

for (const file of requiredFiles) {
  if (!isExistingFile(file)) {
    errors.push(`required public file is missing: ${file}`);
  }
}

for (const executable of [
  "deploy/init-production-db.sh",
  "deploy/install.sh",
  "deploy/manage.sh",
]) {
  if (
    isExistingFile(executable) &&
    (statSync(resolve(repositoryRoot, executable)).mode & 0o111) === 0
  ) {
    errors.push(`${executable} must be executable`);
  }
}

const documentedConfigurationVariables = [
  "DATABASE_URL",
  "APP_ORIGIN",
  "VISITOR_TOKEN_SECRET",
  "BOARD_ACCESS_SECRET",
  "RATE_LIMIT_KEY_SECRET",
  "TRUSTED_PROXY_HOPS",
  "BOARD_RETENTION_DAYS",
  "BOARD_CARD_LIMIT",
  "RETENTION_CLEANUP_ENABLED",
  "RETENTION_CLEANUP_INTERVAL_MINUTES",
  "RETENTION_CLEANUP_BATCH_SIZE",
  "NEXT_TELEMETRY_DISABLED",
  "NODE_ENV",
  "PORT",
  "HOSTNAME",
  "NEXT_RUNTIME",
  "NEXT_PHASE",
  "COMPOSE_PROJECT_NAME",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "POSTGRES_MIGRATOR_USER",
  "POSTGRES_MIGRATOR_PASSWORD",
  "POSTGRES_RUNTIME_USER",
  "POSTGRES_RUNTIME_PASSWORD",
  "POSTGRES_PORT",
  "APP_PORT",
  "DOCKER_DATABASE_URL",
  "DOCKER_MIGRATOR_DATABASE_URL",
  "DOCKER_RUNTIME_DATABASE_URL",
  "DATABASE_RUNTIME_ROLE",
  "DOCKER_APP_ORIGIN",
  "DOCKER_VISITOR_TOKEN_SECRET",
  "DOCKER_BOARD_ACCESS_SECRET",
  "DOCKER_RATE_LIMIT_KEY_SECRET",
  "BADACTION_DOMAIN",
  "CADDY_ACME_EMAIL",
  "DOCKER_RUNNER_IMAGE",
  "DOCKER_MIGRATOR_IMAGE",
  "TEST_DATABASE_IS_DISPOSABLE",
  "RUN_DATABASE_TESTS",
  "ACCESS_SMOKE_PORT",
  "E2E_PORT",
  "PLAYWRIGHT_EXTERNAL_SERVER",
  "PLAYWRIGHT_EXTERNAL_SERVER_IS_DISPOSABLE",
  "PLAYWRIGHT_BASE_URL",
  "SMOKE_BASE_URL",
  "SMOKE_ORIGIN",
  "DOCKER_SMOKE_SKIP_BUILD",
  "DOCKER_SMOKE_PRODUCTION",
  "CI",
  "UPDATE_PRODUCT_SCREENSHOT",
];

for (const file of [
  "docs/configuration.md",
  "docs/ru/configuration.md",
  "docs/es/configuration.md",
]) {
  if (!isExistingFile(file)) {
    continue;
  }
  const configuration = readFileSync(resolve(repositoryRoot, file), "utf8");
  for (const variable of documentedConfigurationVariables) {
    if (!configuration.includes(`\`${variable}\``)) {
      errors.push(`${file}: does not document ${variable}`);
    }
  }
}

const requiredScreenshots = [
  "docs/assets/product-board.png",
  "docs/assets/product-board-mobile.png",
];

for (const file of requiredScreenshots) {
  if (!isExistingFile(file)) {
    errors.push(`required screenshot is missing: ${file}`);
  } else if (statSync(resolve(repositoryRoot, file)).size === 0) {
    errors.push(`required screenshot is empty: ${file}`);
  }
}

if (!trackedExistingSet.has(".env.example")) {
  errors.push(".env.example must exist and remain tracked by Git");
}

for (const file of trackedExistingFiles) {
  const basename = file.split("/").at(-1);
  if (isEnvironmentFileName(basename)) {
    errors.push(`environment file must not be tracked: ${file}`);
  }

  if (file === "docs.local" || file.startsWith("docs.local/")) {
    errors.push(`internal documentation must not be tracked: ${file}`);
  }
}

for (const ignoredDirectory of ["docs.local", "backups"]) {
  const ignoreProbe = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", `${ignoredDirectory}/__check__`],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );

  if (ignoreProbe.status !== 0) {
    errors.push(`${ignoredDirectory}/ must be ignored by Git`);
  }
}

for (const environmentFile of [".env.local", "production.env"]) {
  const ignoreProbe = spawnSync(
    "git",
    ["check-ignore", "--quiet", "--no-index", environmentFile],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );

  if (ignoreProbe.status !== 0) {
    errors.push(`${environmentFile} must be ignored by Git`);
  }
}

if (!isExistingFile(".dockerignore")) {
  errors.push(".dockerignore is missing");
} else {
  const dockerignoreRules = readFileSync(
    resolve(repositoryRoot, ".dockerignore"),
    "utf8",
  )
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  const dockerignoreRuleSet = new Set(dockerignoreRules);
  const dockerIgnoredDirectories = new Map([
    ["docs.local", false],
    ["backups", false],
  ]);

  for (const rule of dockerignoreRules) {
    const negated = rule.startsWith("!");
    const normalizedRule = (negated ? rule.slice(1) : rule)
      .replace(/^\//u, "")
      .replace(/\/$/u, "");

    if (dockerIgnoredDirectories.has(normalizedRule)) {
      dockerIgnoredDirectories.set(normalizedRule, !negated);
    }
  }

  for (const [directory, ignored] of dockerIgnoredDirectories) {
    if (!ignored) {
      errors.push(`.dockerignore must exclude ${directory}/`);
    }
  }

  for (const rule of [".env", ".env.*", "*.env", "*.env.*"]) {
    if (!dockerignoreRuleSet.has(rule)) {
      errors.push(`.dockerignore must exclude environment files with ${rule}`);
    }
  }
}

const stripFencedCodeBlocks = (markdown) => {
  let fence = null;

  return markdown
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/u)?.[1];

      if (fence === null && marker) {
        fence = marker;
        return "";
      }

      if (fence !== null) {
        if (
          marker?.[0] === fence[0] &&
          marker.length >= fence.length &&
          /^\s*$/u.test(line.slice(line.indexOf(marker) + marker.length))
        ) {
          fence = null;
        }
        return "";
      }

      return line;
    })
    .join("\n");
};

const extractMarkdownLinks = (markdown) => {
  const links = [];
  const withoutCodeBlocks = stripFencedCodeBlocks(markdown);
  const inlineLinkPattern =
    /(!?)\[[^\]]*\]\(\s*(<[^>\n]+>|(?:[^()\s]|\([^()\n]*\))+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/gu;
  const referenceLinkPattern = /^\s{0,3}\[(?!\^)[^\]]+\]:\s*(<[^>\n]+>|\S+)/gmu;

  for (const match of withoutCodeBlocks.matchAll(inlineLinkPattern)) {
    links.push({
      destination: match[2],
      image: match[1] === "!",
      line: withoutCodeBlocks.slice(0, match.index).split("\n").length,
    });
  }

  for (const match of withoutCodeBlocks.matchAll(referenceLinkPattern)) {
    links.push({
      destination: match[1],
      image: false,
      line: withoutCodeBlocks.slice(0, match.index).split("\n").length,
    });
  }

  return links;
};

const toRepositoryPath = (sourceFile, rawDestination) => {
  let destination = rawDestination.trim();
  if (destination.startsWith("<") && destination.endsWith(">")) {
    destination = destination.slice(1, -1);
  }

  if (
    destination === "" ||
    destination.startsWith("#") ||
    destination.startsWith("//") ||
    destination.startsWith("/") ||
    /^[a-z][a-z\d+.-]*:/iu.test(destination)
  ) {
    return null;
  }

  const pathOnly = destination.split(/[?#]/u, 1)[0];
  if (pathOnly === "") {
    return sourceFile;
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathOnly).replaceAll("\\ ", " ");
  } catch {
    return { error: `invalid URL encoding in link target: ${rawDestination}` };
  }

  const absoluteTarget = resolve(
    dirname(resolve(repositoryRoot, sourceFile)),
    decodedPath,
  );
  const repositoryPath = relative(repositoryRoot, absoluteTarget);

  if (
    repositoryPath === ".." ||
    repositoryPath.startsWith(`..${sep}`) ||
    isAbsolute(repositoryPath)
  ) {
    return { error: `relative link escapes the repository: ${rawDestination}` };
  }

  return repositoryPath.split(sep).join("/") || ".";
};

const existsWithExactCase = (repositoryPath) => {
  if (repositoryPath === ".") {
    return true;
  }

  let currentPath = repositoryRoot;
  for (const segment of repositoryPath.split("/")) {
    if (!existsSync(currentPath) || !statSync(currentPath).isDirectory()) {
      return false;
    }

    if (!readdirSync(currentPath).includes(segment)) {
      return false;
    }
    currentPath = resolve(currentPath, segment);
  }

  return existsSync(currentPath);
};

const markdownFiles = repositoryFiles.filter((file) => file.endsWith(".md"));

for (const file of markdownFiles) {
  const markdown = readFileSync(resolve(repositoryRoot, file), "utf8");

  if (/docs\.local(?:[/\\]|\b)/iu.test(markdown)) {
    errors.push(`${file}: public Markdown must not reference docs.local`);
  }

  for (const link of extractMarkdownLinks(markdown)) {
    const target = toRepositoryPath(file, link.destination);
    if (target === null) {
      continue;
    }
    if (typeof target === "object") {
      errors.push(`${file}:${link.line}: ${target.error}`);
      continue;
    }
    if (!existsWithExactCase(target)) {
      errors.push(
        `${file}:${link.line}: relative link target does not exist with exact casing: ${link.destination}`,
      );
      continue;
    }

    const absoluteTarget = resolve(repositoryRoot, target);
    if (
      link.image &&
      statSync(absoluteTarget).isFile() &&
      statSync(absoluteTarget).size === 0
    ) {
      errors.push(
        `${file}:${link.line}: linked image is empty: ${link.destination}`,
      );
    }
  }
}

const languageLabels = ["[English]", "[Русский]", "[Español]"];
const languageSwitcherGroups = [
  {
    files: ["README.md", "README.ru.md", "README.es.md"],
    targets: ["README.md", "README.ru.md", "README.es.md"],
  },
  ...documentationPages.map((page) => ({
    files: [`docs/${page}`, `docs/ru/${page}`, `docs/es/${page}`],
    targets: [`docs/${page}`, `docs/ru/${page}`, `docs/es/${page}`],
  })),
];

const resolvedTargets = (sourceFile, markdown) =>
  new Set(
    extractMarkdownLinks(markdown)
      .map((link) => toRepositoryPath(sourceFile, link.destination))
      .filter((target) => typeof target === "string"),
  );

for (const group of languageSwitcherGroups) {
  for (const file of group.files) {
    if (!isExistingFile(file)) {
      continue;
    }

    const markdown = readFileSync(resolve(repositoryRoot, file), "utf8");
    const switcher = markdown.split("\n").slice(0, 12).join("\n");
    const targets = resolvedTargets(file, switcher);

    for (const label of languageLabels) {
      if (!switcher.includes(label)) {
        errors.push(`${file}: language switcher is missing ${label}`);
      }
    }
    for (const target of group.targets) {
      if (!targets.has(target)) {
        errors.push(
          `${file}: language switcher is missing a link to ${target}`,
        );
      }
    }
  }
}

const localizedDocumentationTargets = new Map([
  ["README.md", "docs/README.md"],
  ["README.ru.md", "docs/ru/README.md"],
  ["README.es.md", "docs/es/README.md"],
]);

for (const [file, expectedTarget] of localizedDocumentationTargets) {
  if (!isExistingFile(file)) {
    continue;
  }

  const markdown = readFileSync(resolve(repositoryRoot, file), "utf8");
  if (!resolvedTargets(file, markdown).has(expectedTarget)) {
    errors.push(
      `${file}: must link to localized documentation at ${expectedTarget}`,
    );
  }
}

if (
  isExistingFile("README.md") &&
  !resolvedTargets(
    "README.md",
    readFileSync(resolve(repositoryRoot, "README.md"), "utf8"),
  ).has("docs/assets/product-board.png")
) {
  errors.push("README.md must link to docs/assets/product-board.png");
}

const internalMarkerPatterns = [
  ["numbered internal stage", /\b(?:stage|phase)\s+[0-9]+\b/iu],
  ["internal plan", /\b(?:implementation|completion)\s+plan\b/iu],
  ["internal gap report", /\bgap\s+(?:analysis|audit)\b/iu],
  ["internal release report", /\brelease[- ]report\b/iu],
  ["internal backlog", /\b(?:backlog|roadmap)\b/iu],
  ["internal acceptance notes", /\bdefinition of done\b/iu],
  ["agent-specific notes", /\bcodex\b/iu],
  ["numbered internal stage", /(?:этап|фаза)\s*[№#]?\s*[0-9]+/iu],
  [
    "internal planning report",
    /(?:план (?:реализации|завершения)|аудит (?:полноты|расхождений)|итогов(?:ый|ого) отч[её]т|техническ(?:ое|ого) задани[ея]|бэклог)/iu,
  ],
  [
    "internal planning report",
    /\b(?:plan de implementaci[oó]n|an[aá]lisis de brechas|informe de lanzamiento|hoja de ruta)\b/iu,
  ],
  [
    "legacy internal document",
    /(?:implementation-plan|project-completion-plan|release-report|requirements-gap-audit|ui-ux-redesign|finalization_project)\.md/iu,
  ],
];

const publicDocumentationFiles = repositoryFiles.filter(
  (file) =>
    (file === "README.md" ||
      file === "README.ru.md" ||
      file === "README.es.md" ||
      file.startsWith("docs/")) &&
    file.endsWith(".md"),
);

for (const file of publicDocumentationFiles) {
  const markdown = stripFencedCodeBlocks(
    readFileSync(resolve(repositoryRoot, file), "utf8"),
  );

  for (const [label, pattern] of internalMarkerPatterns) {
    const match = markdown.match(pattern);
    if (match?.index !== undefined) {
      const line = markdown.slice(0, match.index).split("\n").length;
      errors.push(`${file}:${line}: contains ${label}`);
    }
  }
}

const legacyPublicDocumentPattern =
  /docs\/(?:01-product-overview|02-functional-requirements|03-architecture-and-api|04-data-model|05-implementation-plan|06-operations|07-project-completion-plan|08-target-contracts|09-release-report|10-requirements-gap-audit|10-ui-ux-redesign|finalization_project|redesign)\.md/iu;
const publicAutomationFiles = repositoryFiles.filter(
  (file) =>
    file !== "scripts/check-documentation.mjs" &&
    (file.startsWith("scripts/") || file.startsWith(".github/workflows/")),
);

for (const file of publicAutomationFiles) {
  const contents = readFileSync(resolve(repositoryRoot, file));
  if (contents.includes(0)) {
    continue;
  }

  const text = contents.toString("utf8");
  const match = text.match(legacyPublicDocumentPattern);
  if (match?.index !== undefined) {
    const line = text.slice(0, match.index).split("\n").length;
    errors.push(`${file}:${line}: references a legacy public document path`);
  }
}

if (errors.length > 0) {
  console.error("Documentation check failed:");
  for (const error of [...new Set(errors)].sort()) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Documentation check passed (${markdownFiles.length} Markdown files checked)`,
  );
}

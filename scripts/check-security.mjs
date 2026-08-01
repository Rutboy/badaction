import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => existsSync(file) && statSync(file).isFile());

const credentialPatterns = [
  ["private key", /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  [
    "GitHub token",
    /\b(?:gh[opurs]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
  ],
  ["Google API key", /\bAIza[A-Za-z0-9_-]{35}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["Stripe live secret", /\bsk_live_[A-Za-z0-9]{20,}\b/g],
];

const sourceSinkPatterns = [
  ["unsafe Prisma raw query", /\$(?:executeRawUnsafe|queryRawUnsafe)\s*\(/g],
  ["raw HTML rendering", /\bdangerouslySetInnerHTML\b/g],
  ["dynamic code evaluation", /\beval\s*\(|\bnew\s+Function\s*\(/g],
  ["wildcard CORS", /Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']/g],
];

const findings = [];

const inspect = (file, text, patterns) => {
  for (const [label, pattern] of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line}: ${label}`);
    }
  }
};

for (const file of trackedFiles) {
  const contents = readFileSync(file);
  if (contents.includes(0)) {
    continue;
  }

  const text = contents.toString("utf8");
  inspect(file, text, credentialPatterns);

  if (file.startsWith("src/") && /\.[cm]?[jt]sx?$/.test(file)) {
    inspect(file, text, sourceSinkPatterns);
  }

  if (/^src\/app\/api\/(?:.*\/)?(?:debug|diagnostics?)(?:\/|$)/.test(file)) {
    findings.push(`${file}: production debug endpoint`);
  }
}

if (findings.length > 0) {
  console.error("Security check found blocked patterns:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exitCode = 1;
} else {
  console.log("Security check passed");
}

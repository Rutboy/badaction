import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const repositoryRoot = new URL("../../../", import.meta.url);

const STAGE_2_ROUTES = new Map([
  ["src/app/api/boards/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/route.ts", ["GET", "PATCH", "DELETE"]],
  ["src/app/api/boards/[boardId]/columns/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/columns/[columnId]/route.ts", ["PATCH", "DELETE"]],
  ["src/app/api/boards/[boardId]/columns/[columnId]/move/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/cards/route.ts", ["GET", "POST"]],
  ["src/app/api/boards/[boardId]/cards/[cardId]/route.ts", ["PATCH", "DELETE"]],
  ["src/app/api/boards/[boardId]/cards/[cardId]/move/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/cards/[cardId]/vote/route.ts", ["PUT", "DELETE"]],
  ["src/app/api/boards/[boardId]/votes/reset/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/groups/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/groups/[groupId]/route.ts", ["PATCH"]],
  ["src/app/api/boards/[boardId]/groups/[groupId]/move/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/groups/[groupId]/ungroup/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/action-items/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/action-items/[actionItemId]/route.ts", ["PATCH", "DELETE"]],
  ["src/app/api/boards/[boardId]/action-items/[actionItemId]/move/route.ts", ["POST"]],
  ["src/app/api/boards/[boardId]/export.json/route.ts", ["GET"]],
  ["src/app/api/boards/[boardId]/export.csv/route.ts", ["GET"]],
  ["src/app/api/boards/[boardId]/export.md/route.ts", ["GET"]],
  ["src/app/api/boards/[boardId]/invitations/route.ts", ["GET", "POST"]],
  ["src/app/api/boards/[boardId]/invitations/[invitationId]/route.ts", ["DELETE"]],
  ["src/app/api/boards/[boardId]/members/route.ts", ["GET"]],
  ["src/app/api/boards/[boardId]/members/[membershipId]/route.ts", ["DELETE"]],
  ["src/app/api/boards/[boardId]/membership/route.ts", ["PATCH", "DELETE"]],
  ["src/app/api/invitations/redeem/route.ts", ["POST"]],
  ["src/app/api/health/route.ts", ["GET"]],
]);

const readRepositoryFile = (path) => readFile(new URL(path, repositoryRoot), "utf8");

const exportedHttpMethods = (source) => Array.from(
  source.matchAll(/^export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/gm),
  (match) => match[1],
).sort();

const listSourceFiles = async (path) => {
  const directory = new URL(`${path}/`, repositoryRoot);
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await listSourceFiles(relativePath));
    } else if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(relativePath);
    }
  }
  return files;
};

test("Stage 2 exposes every target content and compatible access route", async () => {
  for (const [path, expectedMethods] of STAGE_2_ROUTES) {
    const source = await readRepositoryFile(path);
    assert.deepEqual(
      exportedHttpMethods(source),
      [...expectedMethods].sort(),
      `${path} must export exactly ${expectedMethods.join(", ")}`,
    );
  }
});

test("Stage 3 exposes the authorized Node SSE endpoint", async () => {
  const path = "src/app/api/boards/[boardId]/events/route.ts";
  const source = await readRepositoryFile(path);

  assert.deepEqual(exportedHttpMethods(source), ["GET"]);
  assert.match(source, /export const runtime = "nodejs"/);
  assert.match(source, /text\/event-stream; charset=utf-8/);
  assert.match(source, /Last-Event-ID|last-event-id/);
  assert.match(source, /getBoardEventAccessState/);
  assert.match(source, /assertBoardEventsRateLimits/);
});

test("the deprecated like adapter remains explicit and isolated from target callers", async () => {
  const legacyRoutePath = "src/app/api/boards/[boardId]/cards/[cardId]/like/route.ts";
  const legacyRoute = await readRepositoryFile(legacyRoutePath);
  assert.deepEqual(exportedHttpMethods(legacyRoute), ["POST"]);
  assert.match(
    legacyRoute,
    /(?:(?:Deprecation|["']Deprecation["'])\s*:\s*["']true["']|\.set\(\s*["']Deprecation["']\s*,\s*["']true["']\s*\))/,
    `${legacyRoutePath} must send Deprecation: true`,
  );

  const uiFiles = [
    ...await listSourceFiles("src/components"),
    "src/app/page.tsx",
    "src/app/boards/[boardId]/page.tsx",
    "src/app/join/page.tsx",
  ];
  const callerFiles = [...uiFiles, "scripts/smoke-access.mjs"];
  callerFiles.push("src/lib/pagination/board-state.ts");
  for (const path of callerFiles) {
    const source = await readRepositoryFile(path);
    assert.doesNotMatch(source, /\/cards\/[^\s"'`]*\/like\b/, `${path} calls legacy /like`);
    assert.doesNotMatch(source, /\b(?:WENT_WELL|TO_IMPROVE|ACTIONS)\b/, `${path} uses a fixed column enum`);
    assert.doesNotMatch(source, /\blikesCount\b/, `${path} reads the legacy likesCount field`);
    assert.doesNotMatch(source, /constants\/columns/, `${path} imports fixed column constants`);
  }
});

test("the production smoke exercises dynamic IDs and explicit vote and unvote", async () => {
  const smoke = await readRepositoryFile("scripts/smoke-access.mjs");
  assert.match(smoke, /JSON\.stringify\(\{\s*title:/);
  assert.match(smoke, /columnId:\s*sourceColumn\.id/);
  assert.match(smoke, /\/vote`?,\s*\{\s*method:\s*"PUT"\s*\}/);
  assert.match(smoke, /\/vote`?,\s*\{\s*method:\s*"DELETE"\s*\}/);
  assert.match(smoke, /\/columns`?,\s*\{/);
  assert.match(smoke, /\/members\/\$\{firstMembership\.membershipId\}/);
  assert.match(smoke, /\/membership`?,\s*\{\s*method:\s*"DELETE"\s*\}/);
});

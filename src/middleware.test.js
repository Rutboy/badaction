import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server.js";

test("middleware matcher covers board pages and board APIs", async () => {
  const source = await readFile(new URL("./middleware.ts", import.meta.url), "utf8");
  const matcherSource = /matcher:\s*\[([^\]]+)\]/s.exec(source)?.[1] ?? "";
  const matcher = [...matcherSource.matchAll(/"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const runtime = /runtime:\s*"([^"]+)"/.exec(source)?.[1];

  assert.deepEqual(matcher, [
    "/boards/:boardId",
    "/api/boards/:path*",
    "/api/invitations/:path*",
  ]);
  assert.equal(runtime, "nodejs");

  const config = { matcher, runtime };
  assert.equal(
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: "/boards/e3033b7f-58e4-42a5-b2fa-1a98069f3aa2",
    }),
    true,
  );
  assert.equal(
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: "/api/boards/e3033b7f-58e4-42a5-b2fa-1a98069f3aa2",
    }),
    true,
  );
  assert.equal(
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/api/boards" }),
    true,
  );
  assert.equal(
    unstable_doesMiddlewareMatch({
      config,
      nextConfig: {},
      url: "/api/invitations/redeem",
    }),
    true,
  );
  assert.equal(
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "/" }),
    false,
  );
});

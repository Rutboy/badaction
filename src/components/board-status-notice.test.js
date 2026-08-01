import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("connection notices are delayed without duplicating the live indicator", async () => {
  const notice = await readFile(
    new URL("./board/board-status-notice.tsx", import.meta.url),
    "utf8",
  );
  const indicator = await readFile(
    new URL("./board/connection-indicator.tsx", import.meta.url),
    "utf8",
  );

  assert.match(notice, /PERSISTENT_CONNECTION_NOTICE_DELAY_MS = 10_000/);
  assert.match(
    notice,
    /window\.setTimeout\([\s\S]*PERSISTENT_CONNECTION_NOTICE_DELAY_MS/,
  );
  assert.match(
    notice,
    /connectionStatus === "reconnecting" \|\| connectionStatus === "polling"/,
  );
  assert.match(notice, /visiblePersistentConnectionMessage/);
  assert.match(notice, /<span aria-hidden="true">/);
  assert.match(notice, /<span role="alert">/);
  assert.doesNotMatch(notice, /aria-live=/);

  assert.match(indicator, /role="status"/);
  assert.match(indicator, /aria-live="polite"/);
});

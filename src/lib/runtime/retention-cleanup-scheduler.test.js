import assert from "node:assert/strict";
import test from "node:test";
import {
  getRetentionCleanupEvent,
  RetentionCleanupScheduler,
} from "./retention-cleanup-scheduler.ts";
import {
  getRetentionCleanupBatchSize,
  getRetentionCleanupIntervalMinutes,
  isRetentionCleanupEnabled,
} from "../config/retention-cleanup.ts";

const emptyResult = {
  advisoryLockAcquired: true,
  skipReason: null,
  aborted: false,
  boardsDeleted: 0,
  boardDeleteFailures: 0,
  boardCleanupChunks: 0,
  boardCandidatesDeferred: 0,
  rateLimitBucketsDeleted: 0,
  anonymousSessionsDeleted: 0,
  failedSteps: [],
};

const createFakeTimers = () => {
  const timers = [];
  const setTimer = (callback, delayMs) => {
    const timer = { callback, delayMs, cleared: false, unref: () => undefined };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    timer.cleared = true;
  };
  return { timers, setTimer, clearTimer };
};

const flushBackgroundWork = () =>
  new Promise((resolve) => setImmediate(resolve));

test("scheduler starts immediately and spaces runs from completion", async () => {
  const timers = createFakeTimers();
  const pendingRuns = [];
  const signals = [];
  const scheduler = new RetentionCleanupScheduler({
    intervalMs: 1234,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    runCleanup: (signal) => {
      signals.push(signal);
      return new Promise((resolve) => pendingRuns.push(resolve));
    },
  });

  scheduler.start();
  scheduler.start();
  assert.equal(pendingRuns.length, 1);
  assert.equal(timers.timers.length, 0);

  pendingRuns[0](emptyResult);
  await flushBackgroundWork();
  assert.equal(timers.timers.length, 1);
  assert.equal(timers.timers[0].delayMs, 1234);

  timers.timers[0].callback();
  assert.equal(pendingRuns.length, 2);
  assert.equal(signals[0].aborted, false);
  assert.equal(signals[1].aborted, false);

  const shutdown = scheduler.shutdown();
  assert.equal(signals[1].aborted, true);
  pendingRuns[1]({ ...emptyResult, aborted: true });
  await shutdown;
  await flushBackgroundWork();
  assert.equal(
    timers.timers.length,
    1,
    "shutdown must not schedule another run",
  );
});

test("scheduler clears a pending opportunistic run during shutdown", async () => {
  const timers = createFakeTimers();
  const scheduler = new RetentionCleanupScheduler({
    intervalMs: 60_000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    runCleanup: async () => emptyResult,
  });

  scheduler.start();
  await flushBackgroundWork();
  assert.equal(timers.timers.length, 1);
  await scheduler.shutdown();
  assert.equal(timers.timers[0].cleared, true);
});

test("retention scheduling settings are bounded", () => {
  assert.equal(isRetentionCleanupEnabled({}), true);
  assert.equal(
    isRetentionCleanupEnabled({ RETENTION_CLEANUP_ENABLED: "1" }),
    true,
  );
  assert.equal(
    isRetentionCleanupEnabled({ RETENTION_CLEANUP_ENABLED: "true" }),
    true,
  );
  assert.equal(
    isRetentionCleanupEnabled({ RETENTION_CLEANUP_ENABLED: "0" }),
    false,
  );
  assert.equal(
    isRetentionCleanupEnabled({ RETENTION_CLEANUP_ENABLED: "false" }),
    false,
  );
  assert.equal(getRetentionCleanupIntervalMinutes({}), 60);
  assert.equal(getRetentionCleanupBatchSize({}), 1000);
  assert.equal(
    getRetentionCleanupIntervalMinutes({
      RETENTION_CLEANUP_INTERVAL_MINUTES: "1",
    }),
    1,
  );
  assert.equal(
    getRetentionCleanupBatchSize({
      RETENTION_CLEANUP_BATCH_SIZE: "10000",
    }),
    10000,
  );

  assert.throws(
    () => isRetentionCleanupEnabled({ RETENTION_CLEANUP_ENABLED: "yes" }),
    /must be one of/,
  );
  assert.throws(
    () =>
      getRetentionCleanupIntervalMinutes({
        RETENTION_CLEANUP_INTERVAL_MINUTES: "0",
      }),
    /between 1 and 1440/,
  );
  assert.throws(
    () =>
      getRetentionCleanupBatchSize({
        RETENTION_CLEANUP_BATCH_SIZE: "10001",
      }),
    /between 1 and 10000/,
  );
});

test("cleanup logs distinguish completion, abort, and skip reasons", () => {
  assert.equal(
    getRetentionCleanupEvent(emptyResult),
    "retention_cleanup_completed",
  );
  assert.equal(
    getRetentionCleanupEvent({
      ...emptyResult,
      aborted: true,
    }),
    "retention_cleanup_aborted",
  );
  assert.equal(
    getRetentionCleanupEvent({
      ...emptyResult,
      advisoryLockAcquired: false,
      skipReason: "advisory-lock",
    }),
    "retention_cleanup_skipped_advisory_lock",
  );
  assert.equal(
    getRetentionCleanupEvent({
      ...emptyResult,
      skipReason: "minimum-interval",
    }),
    "retention_cleanup_skipped_minimum_interval",
  );
});

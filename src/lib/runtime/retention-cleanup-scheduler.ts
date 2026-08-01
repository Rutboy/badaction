import {
  getRetentionCleanupBatchSize,
  getRetentionCleanupIntervalMinutes,
} from "../config/retention-cleanup.ts";
import { prisma } from "../prisma/client.ts";
import {
  cleanupExpiredData,
  type RetentionCleanupResult,
} from "../services/retention-cleanup-service.ts";

type Timer = ReturnType<typeof setTimeout>;

type RetentionCleanupSchedulerOptions = {
  intervalMs: number;
  runCleanup: (signal: AbortSignal) => Promise<RetentionCleanupResult>;
  setTimer?: (callback: () => void, delayMs: number) => Timer;
  clearTimer?: (timer: Timer) => void;
  onResult?: (result: RetentionCleanupResult) => void;
  onError?: () => void;
};

export class RetentionCleanupScheduler {
  private readonly intervalMs: number;
  private readonly runCleanup: (
    signal: AbortSignal,
  ) => Promise<RetentionCleanupResult>;
  private readonly setTimer: (callback: () => void, delayMs: number) => Timer;
  private readonly clearTimer: (timer: Timer) => void;
  private readonly onResult: (result: RetentionCleanupResult) => void;
  private readonly onError: () => void;
  private timer: Timer | null = null;
  private cleanupAbortController: AbortController | null = null;
  private cleanupPromise: Promise<void> | null = null;
  private started = false;
  private shuttingDown = false;

  constructor({
    intervalMs,
    runCleanup,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onResult = () => undefined,
    onError = () => undefined,
  }: RetentionCleanupSchedulerOptions) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
      throw new Error("intervalMs must be a positive integer");
    }
    this.intervalMs = intervalMs;
    this.runCleanup = runCleanup;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onResult = onResult;
    this.onError = onError;
  }

  start(): void {
    if (this.started || this.shuttingDown) {
      return;
    }
    this.started = true;
    this.launchCleanup();
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      await this.cleanupPromise;
      return;
    }
    this.shuttingDown = true;
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.cleanupAbortController?.abort();
    await this.cleanupPromise;
  }

  private launchCleanup(): void {
    if (this.shuttingDown || this.cleanupPromise) {
      return;
    }

    const abortController = new AbortController();
    this.cleanupAbortController = abortController;
    const cleanupPromise = (async () => {
      try {
        const result = await this.runCleanup(abortController.signal);
        this.onResult(result);
      } catch {
        this.onError();
      } finally {
        this.cleanupAbortController = null;
        this.cleanupPromise = null;
        if (!this.shuttingDown) {
          this.scheduleNextCleanup();
        }
      }
    })();
    this.cleanupPromise = cleanupPromise;
  }

  private scheduleNextCleanup(): void {
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.launchCleanup();
    }, this.intervalMs);
    this.timer.unref?.();
  }
}

export const getRetentionCleanupEvent = (
  result: RetentionCleanupResult,
): string =>
  result.aborted
    ? "retention_cleanup_aborted"
    : result.skipReason === "advisory-lock"
      ? "retention_cleanup_skipped_advisory_lock"
      : result.skipReason === "minimum-interval"
        ? "retention_cleanup_skipped_minimum_interval"
        : "retention_cleanup_completed";

const reportCleanupResult = (result: RetentionCleanupResult): void => {
  const report = JSON.stringify({
    event: getRetentionCleanupEvent(result),
    ...result,
  });
  if (result.failedSteps.length > 0 || result.boardDeleteFailures > 0) {
    console.error(report);
    return;
  }
  console.info(report);
};

export const createRetentionCleanupScheduler = (
  env: NodeJS.ProcessEnv = process.env,
): RetentionCleanupScheduler => {
  const batchSize = getRetentionCleanupBatchSize(env);
  const intervalMs = getRetentionCleanupIntervalMinutes(env) * 60 * 1000;
  return new RetentionCleanupScheduler({
    intervalMs,
    runCleanup: (signal) =>
      cleanupExpiredData({
        prisma,
        batchSize,
        signal,
        minimumIntervalMs: intervalMs,
      }),
    onResult: reportCleanupResult,
    onError: () => console.error("Retention cleanup failed"),
  });
};

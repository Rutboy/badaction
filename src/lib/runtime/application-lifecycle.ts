import { shutdownPostgresBoardListener } from "../realtime/postgres-board-listener.ts";
import {
  createRetentionCleanupScheduler,
  type RetentionCleanupScheduler,
} from "./retention-cleanup-scheduler.ts";
import { isRetentionCleanupEnabled } from "../config/retention-cleanup.ts";
import { beginApplicationDraining } from "./application-draining.ts";
import {
  APPLICATION_LIFECYCLE_SUPERVISOR_ENV,
  createLifecycleReadyMessage,
  createShutdownPreparedMessage,
  createShutdownPrepareFailedMessage,
  isPrepareShutdownMessage,
  type ApplicationLifecycleIpcMessage,
} from "./application-lifecycle-protocol.ts";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 25_000;

export type ApplicationShutdownResult = "complete" | "timeout";

type ApplicationLifecycleOptions = {
  cleanupScheduler: Pick<RetentionCleanupScheduler, "start" | "shutdown">;
  shutdownListener: () => Promise<void>;
  shutdownTimeoutMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  onShutdownTimeout?: () => void;
};

export class ApplicationLifecycle {
  private readonly cleanupScheduler: Pick<
    RetentionCleanupScheduler,
    "start" | "shutdown"
  >;
  private readonly shutdownListener: () => Promise<void>;
  private readonly shutdownTimeoutMs: number;
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly onShutdownTimeout: () => void;
  private started = false;
  private shutdownPromise: Promise<ApplicationShutdownResult> | null = null;

  constructor({
    cleanupScheduler,
    shutdownListener,
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    onShutdownTimeout = () => undefined,
  }: ApplicationLifecycleOptions) {
    if (!Number.isSafeInteger(shutdownTimeoutMs) || shutdownTimeoutMs < 1) {
      throw new Error("shutdownTimeoutMs must be a positive integer");
    }
    this.cleanupScheduler = cleanupScheduler;
    this.shutdownListener = shutdownListener;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onShutdownTimeout = onShutdownTimeout;
  }

  start(): void {
    if (this.started || this.shutdownPromise) {
      return;
    }
    this.started = true;
    this.cleanupScheduler.start();
  }

  shutdown(): Promise<ApplicationShutdownResult> {
    beginApplicationDraining();
    if (!this.shutdownPromise) {
      this.shutdownPromise = this.runShutdown();
    }
    return this.shutdownPromise;
  }

  private async runShutdown(): Promise<ApplicationShutdownResult> {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<"timeout">((resolve) => {
      timeout = this.setTimer(() => resolve("timeout"), this.shutdownTimeoutMs);
      timeout.unref?.();
    });
    const gracefulShutdown = Promise.allSettled([
      this.cleanupScheduler.shutdown(),
      this.shutdownListener(),
    ]).then(() => "complete" as const);
    const outcome = await Promise.race([gracefulShutdown, timeoutPromise]);
    if (timeout) {
      this.clearTimer(timeout);
    }
    if (outcome === "timeout") {
      this.onShutdownTimeout();
    }
    return outcome;
  }
}

type SignalProcess = Pick<NodeJS.Process, "once">;

export const installApplicationShutdownHooks = (
  lifecycle: Pick<ApplicationLifecycle, "shutdown">,
  signalProcess: SignalProcess = process,
  beginDraining: () => void = beginApplicationDraining,
): void => {
  const shutdown = () => {
    beginDraining();
    void lifecycle.shutdown();
  };
  signalProcess.once("SIGINT", shutdown);
  signalProcess.once("SIGTERM", shutdown);
};

type LifecycleIpcProcess = Pick<
  NodeJS.Process,
  "connected" | "off" | "on" | "once" | "send"
>;

type ApplicationLifecycleIpcOptions = {
  beginDraining?: () => void;
  terminate?: () => void;
  onError?: () => void;
};

const sendLifecycleIpcMessage = (
  ipcProcess: LifecycleIpcProcess,
  message: ApplicationLifecycleIpcMessage,
): void => {
  if (!ipcProcess.connected || !ipcProcess.send) {
    return;
  }
  try {
    ipcProcess.send(message, () => undefined);
  } catch {
    // The supervisor may have exited between the connected check and send.
  }
};

export const isApplicationLifecycleSupervised = (
  env: NodeJS.ProcessEnv,
  ipcProcess: Pick<NodeJS.Process, "connected" | "send"> = process,
): boolean =>
  env[APPLICATION_LIFECYCLE_SUPERVISOR_ENV] === "1" &&
  ipcProcess.connected === true &&
  typeof ipcProcess.send === "function";

export const installApplicationLifecycleIpcHooks = (
  lifecycle: Pick<ApplicationLifecycle, "shutdown">,
  ipcProcess: LifecycleIpcProcess = process,
  {
    beginDraining = beginApplicationDraining,
    terminate = () => process.kill(process.pid, "SIGTERM"),
    onError = () => console.error("Application lifecycle shutdown failed"),
  }: ApplicationLifecycleIpcOptions = {},
): (() => void) => {
  let shutdownPromise: Promise<ApplicationShutdownResult> | null = null;
  let terminationRequested = false;
  const shutdown = (): Promise<ApplicationShutdownResult> => {
    if (!shutdownPromise) {
      beginDraining();
      shutdownPromise = lifecycle.shutdown();
    }
    return shutdownPromise;
  };
  const handleMessage = (message: unknown) => {
    if (!isPrepareShutdownMessage(message)) {
      return;
    }
    void shutdown().then(
      (outcome) =>
        sendLifecycleIpcMessage(
          ipcProcess,
          outcome === "complete"
            ? createShutdownPreparedMessage(message.requestId)
            : createShutdownPrepareFailedMessage(message.requestId),
        ),
      () => {
        onError();
        sendLifecycleIpcMessage(
          ipcProcess,
          createShutdownPrepareFailedMessage(message.requestId),
        );
      },
    );
  };
  const handleDisconnect = () => {
    if (terminationRequested) {
      return;
    }
    terminationRequested = true;
    void shutdown()
      .catch(() => onError())
      .finally(terminate);
  };

  ipcProcess.on("message", handleMessage);
  ipcProcess.once("disconnect", handleDisconnect);
  sendLifecycleIpcMessage(ipcProcess, createLifecycleReadyMessage());

  return () => {
    ipcProcess.off("message", handleMessage);
    ipcProcess.off("disconnect", handleDisconnect);
  };
};

const globalForApplicationLifecycle = globalThis as typeof globalThis & {
  applicationLifecycle?: ApplicationLifecycle;
  applicationLifecycleHooks?: boolean;
};

const disabledCleanupScheduler = {
  start: () => undefined,
  shutdown: async () => undefined,
};

export const startApplicationLifecycle = (): ApplicationLifecycle => {
  const lifecycle =
    globalForApplicationLifecycle.applicationLifecycle ??
    new ApplicationLifecycle({
      cleanupScheduler: isRetentionCleanupEnabled()
        ? createRetentionCleanupScheduler()
        : disabledCleanupScheduler,
      shutdownListener: shutdownPostgresBoardListener,
      onShutdownTimeout: () => console.error("Application shutdown timed out"),
    });
  globalForApplicationLifecycle.applicationLifecycle = lifecycle;

  lifecycle.start();
  if (!globalForApplicationLifecycle.applicationLifecycleHooks) {
    if (isApplicationLifecycleSupervised(process.env)) {
      installApplicationLifecycleIpcHooks(lifecycle);
    }
    // Supervised children normally receive a signal only after the IPC ACK.
    // Keep the direct hook as a best-effort fallback for a broken supervisor.
    installApplicationShutdownHooks(lifecycle);
    globalForApplicationLifecycle.applicationLifecycleHooks = true;
  }
  return lifecycle;
};

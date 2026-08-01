import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  APPLICATION_LIFECYCLE_SUPERVISOR_ENV,
  createPrepareShutdownMessage,
  isLifecycleReadyMessage,
  isShutdownPreparedMessage,
  isShutdownPrepareFailedMessage,
} from "../src/lib/runtime/application-lifecycle-protocol.ts";

export const DEFAULT_SHUTDOWN_PREPARE_TIMEOUT_MS = 30_000;

const require = createRequire(import.meta.url);

export const resolveServerLaunch = (
  args,
  {
    cwd = process.cwd(),
    resolveNextEntry = () => require.resolve("next/dist/bin/next"),
    fileExists = existsSync,
  } = {},
) => {
  const [mode, ...serverArgs] = args;
  if (mode === "--next-start") {
    return {
      modulePath: resolveNextEntry(),
      args: ["start", ...serverArgs],
      cwd,
    };
  }
  if (mode === "--standalone") {
    const modulePath = resolve(cwd, "server.js");
    if (!fileExists(modulePath)) {
      throw new Error(`Standalone server entry is missing: ${modulePath}`);
    }
    return { modulePath, args: serverArgs, cwd };
  }
  throw new Error(
    "Expected server mode --next-start or --standalone as the first argument",
  );
};

const exitCodeFromChild = (code, signal) => {
  if (code !== null) {
    return code;
  }
  const signalNumber = signal ? osConstants.signals[signal] : undefined;
  return signalNumber ? 128 + signalNumber : 1;
};

const safeKill = (child, signal) => {
  try {
    child.kill(signal);
  } catch {
    // The child may have exited between the state check and kill.
  }
};

const safeSend = (child, message, onFailure) => {
  if (!child.connected || typeof child.send !== "function") {
    onFailure();
    return;
  }
  try {
    child.send(message, (error) => {
      if (error) {
        onFailure();
      }
    });
  } catch {
    onFailure();
  }
};

export class ServerSupervisor {
  constructor({
    child,
    signalProcess = process,
    prepareTimeoutMs = DEFAULT_SHUTDOWN_PREPARE_TIMEOUT_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    createRequestId = randomUUID,
    onExit = (code) => {
      process.exitCode = code;
    },
    onError = (message) => console.error(message),
  }) {
    if (!Number.isSafeInteger(prepareTimeoutMs) || prepareTimeoutMs < 1) {
      throw new Error("prepareTimeoutMs must be a positive integer");
    }
    this.child = child;
    this.signalProcess = signalProcess;
    this.prepareTimeoutMs = prepareTimeoutMs;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.createRequestId = createRequestId;
    this.onExit = onExit;
    this.onError = onError;
    this.lifecycleReady = false;
    this.shutdownSignal = null;
    this.prepareRequestId = null;
    this.prepareTimer = null;
    this.signalForwarded = false;
    this.stopped = false;
    this.handleSigint = () => this.handleSignal("SIGINT");
    this.handleSigterm = () => this.handleSignal("SIGTERM");
    this.handleMessage = (message) => this.onChildMessage(message);
    this.handleDisconnect = () => this.onChildDisconnect();
    this.handleError = () => this.onChildError();
    this.handleExit = (code, signal) => this.onChildExit(code, signal);
  }

  start() {
    this.child.on("message", this.handleMessage);
    this.child.once("disconnect", this.handleDisconnect);
    this.child.once("error", this.handleError);
    this.child.once("exit", this.handleExit);
    this.signalProcess.on("SIGINT", this.handleSigint);
    this.signalProcess.on("SIGTERM", this.handleSigterm);
    return this;
  }

  handleSignal(signal) {
    if (this.stopped) {
      return;
    }
    if (this.shutdownSignal !== null) {
      this.forceShutdown();
      return;
    }
    this.beginShutdown(signal);
  }

  beginShutdown(signal) {
    this.shutdownSignal = signal;
    this.prepareRequestId = this.createRequestId();
    this.prepareTimer = this.setTimer(() => {
      this.onError("Application lifecycle shutdown preparation timed out");
      this.forwardShutdownSignal();
    }, this.prepareTimeoutMs);
    this.prepareTimer.unref?.();
    if (this.lifecycleReady) {
      this.requestLifecycleShutdown();
    }
  }

  requestLifecycleShutdown() {
    if (
      this.stopped ||
      this.signalForwarded ||
      this.prepareRequestId === null
    ) {
      return;
    }
    safeSend(
      this.child,
      createPrepareShutdownMessage(this.prepareRequestId),
      () => this.forwardShutdownSignal(),
    );
  }

  onChildMessage(message) {
    if (this.stopped) {
      return;
    }
    if (isLifecycleReadyMessage(message)) {
      this.lifecycleReady = true;
      if (this.shutdownSignal !== null) {
        this.requestLifecycleShutdown();
      }
      return;
    }
    if (
      this.prepareRequestId === null ||
      this.signalForwarded ||
      !(
        isShutdownPreparedMessage(message) ||
        isShutdownPrepareFailedMessage(message)
      ) ||
      message.requestId !== this.prepareRequestId
    ) {
      return;
    }
    if (isShutdownPrepareFailedMessage(message)) {
      this.onError("Application lifecycle could not prepare for shutdown");
    }
    this.forwardShutdownSignal();
  }

  onChildDisconnect() {
    this.lifecycleReady = false;
    if (!this.stopped && this.shutdownSignal === null) {
      // The child also observes IPC disconnect and drains before terminating
      // itself. Keep a parent-side deadline in case that hook never ran.
      this.beginShutdown("SIGTERM");
    }
  }

  onChildError() {
    if (this.stopped) {
      return;
    }
    this.onError("Application server process failed");
    this.finish(1);
  }

  onChildExit(code, signal) {
    if (this.stopped) {
      return;
    }
    this.finish(exitCodeFromChild(code, signal));
  }

  forwardShutdownSignal() {
    if (this.stopped || this.signalForwarded || this.shutdownSignal === null) {
      return;
    }
    this.signalForwarded = true;
    this.clearPrepareTimer();
    safeKill(this.child, this.shutdownSignal);
  }

  forceShutdown() {
    if (this.stopped) {
      return;
    }
    this.signalForwarded = true;
    this.clearPrepareTimer();
    safeKill(this.child, "SIGKILL");
  }

  clearPrepareTimer() {
    if (this.prepareTimer) {
      this.clearTimer(this.prepareTimer);
      this.prepareTimer = null;
    }
  }

  finish(code) {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.clearPrepareTimer();
    this.signalProcess.off("SIGINT", this.handleSigint);
    this.signalProcess.off("SIGTERM", this.handleSigterm);
    this.child.off("message", this.handleMessage);
    this.child.off("disconnect", this.handleDisconnect);
    this.child.off("error", this.handleError);
    this.child.off("exit", this.handleExit);
    this.onExit(code);
  }
}

export const runServer = (
  args,
  {
    cwd = process.cwd(),
    env = process.env,
    platform = process.platform,
    forkProcess = fork,
    signalProcess = process,
    resolveLaunch = resolveServerLaunch,
    supervisorOptions = {},
  } = {},
) => {
  const launch = resolveLaunch(args, { cwd });
  const child = forkProcess(launch.modulePath, launch.args, {
    cwd: launch.cwd,
    detached: platform !== "win32",
    env: {
      ...env,
      [APPLICATION_LIFECYCLE_SUPERVISOR_ENV]: "1",
    },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });
  return new ServerSupervisor({
    child,
    signalProcess,
    ...supervisorOptions,
  }).start();
};

const scriptPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (scriptPath === import.meta.url) {
  try {
    runServer(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Unable to start application server: ${message}`);
    process.exitCode = 1;
  }
}

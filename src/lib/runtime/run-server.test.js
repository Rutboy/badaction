import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  resolveServerLaunch,
  runServer,
  ServerSupervisor,
} from "../../../scripts/run-server.mjs";
import {
  APPLICATION_LIFECYCLE_IPC_NAMESPACE,
  APPLICATION_LIFECYCLE_SUPERVISOR_ENV,
} from "./application-lifecycle-protocol.ts";

class FakeChild extends EventEmitter {
  connected = true;
  sent = [];
  kills = [];

  send(message, callback) {
    this.sent.push(message);
    callback?.(null);
    return true;
  }

  kill(signal) {
    this.kills.push(signal);
    return true;
  }
}

const createFakeTimers = () => {
  const timers = [];
  const setTimer = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      unref: () => undefined,
    };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    timer.cleared = true;
  };
  return { timers, setTimer, clearTimer };
};

const readyMessage = {
  namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
  type: "lifecycle-ready",
};

test("server modes resolve direct Next start and the standalone entry", () => {
  assert.deepEqual(
    resolveServerLaunch(["--next-start", "--port", "4000"], {
      cwd: "/workspace",
      resolveNextEntry: () => "/workspace/node_modules/next/dist/bin/next",
    }),
    {
      modulePath: "/workspace/node_modules/next/dist/bin/next",
      args: ["start", "--port", "4000"],
      cwd: "/workspace",
    },
  );
  assert.deepEqual(
    resolveServerLaunch(["--standalone"], {
      cwd: "/app",
      fileExists: () => true,
    }),
    { modulePath: "/app/server.js", args: [], cwd: "/app" },
  );
  assert.throws(() => resolveServerLaunch([]), /Expected server mode/);
  assert.throws(
    () =>
      resolveServerLaunch(["--standalone"], {
        cwd: "/app",
        fileExists: () => false,
      }),
    /Standalone server entry is missing/,
  );
});

test("runServer forks an isolated supervised child on POSIX", () => {
  const child = new FakeChild();
  const signalProcess = new EventEmitter();
  const calls = [];
  const exits = [];
  runServer(["--next-start"], {
    cwd: "/workspace",
    env: { EXISTING: "value" },
    platform: "linux",
    signalProcess,
    resolveLaunch: () => ({
      modulePath: "/next-entry.js",
      args: ["start"],
      cwd: "/workspace",
    }),
    forkProcess: (modulePath, args, options) => {
      calls.push({ modulePath, args, options });
      return child;
    },
    supervisorOptions: { onExit: (code) => exits.push(code) },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.detached, true);
  assert.deepEqual(calls[0].options.stdio, [
    "inherit",
    "inherit",
    "inherit",
    "ipc",
  ]);
  assert.equal(calls[0].options.env.EXISTING, "value");
  assert.equal(calls[0].options.env[APPLICATION_LIFECYCLE_SUPERVISOR_ENV], "1");

  child.emit("exit", 0, null);
  assert.deepEqual(exits, [0]);
});

test("first signal waits for matching lifecycle ACK before reaching Next", () => {
  const child = new FakeChild();
  const signalProcess = new EventEmitter();
  const timers = createFakeTimers();
  const supervisor = new ServerSupervisor({
    child,
    signalProcess,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    createRequestId: () => "shutdown-1",
    onExit: () => undefined,
  }).start();

  child.emit("message", readyMessage);
  signalProcess.emit("SIGTERM");
  assert.deepEqual(child.kills, []);
  assert.deepEqual(child.sent, [
    {
      namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
      type: "prepare-shutdown",
      requestId: "shutdown-1",
    },
  ]);
  child.emit("message", {
    namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
    type: "shutdown-prepared",
    requestId: "another-request",
  });
  assert.deepEqual(child.kills, []);
  child.emit("message", {
    namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
    type: "shutdown-prepared",
    requestId: "shutdown-1",
  });
  assert.deepEqual(child.kills, ["SIGTERM"]);
  assert.equal(timers.timers[0].cleared, true);

  child.emit("exit", 0, null);
  assert.equal(supervisor.stopped, true);
});

test("an early signal starts prepare as soon as the lifecycle becomes ready", () => {
  const child = new FakeChild();
  const signalProcess = new EventEmitter();
  const timers = createFakeTimers();
  new ServerSupervisor({
    child,
    signalProcess,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    createRequestId: () => "early-signal",
    onExit: () => undefined,
  }).start();

  signalProcess.emit("SIGTERM");
  assert.deepEqual(child.sent, []);
  child.emit("message", readyMessage);
  assert.deepEqual(child.sent, [
    {
      namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
      type: "prepare-shutdown",
      requestId: "early-signal",
    },
  ]);

  child.emit("exit", 0, null);
});

test("prepare deadline forwards the original signal and a second signal forces", () => {
  const deadlineChild = new FakeChild();
  const deadlineSignals = new EventEmitter();
  const deadlineTimers = createFakeTimers();
  const deadlineErrors = [];
  new ServerSupervisor({
    child: deadlineChild,
    signalProcess: deadlineSignals,
    prepareTimeoutMs: 1234,
    setTimer: deadlineTimers.setTimer,
    clearTimer: deadlineTimers.clearTimer,
    createRequestId: () => "deadline",
    onExit: () => undefined,
    onError: (message) => deadlineErrors.push(message),
  }).start();
  deadlineSignals.emit("SIGINT");
  assert.equal(deadlineTimers.timers[0].delayMs, 1234);
  deadlineTimers.timers[0].callback();
  assert.deepEqual(deadlineChild.kills, ["SIGINT"]);
  assert.deepEqual(deadlineErrors, [
    "Application lifecycle shutdown preparation timed out",
  ]);
  deadlineChild.emit("exit", 0, null);

  const forcedChild = new FakeChild();
  const forcedSignals = new EventEmitter();
  const forcedTimers = createFakeTimers();
  new ServerSupervisor({
    child: forcedChild,
    signalProcess: forcedSignals,
    setTimer: forcedTimers.setTimer,
    clearTimer: forcedTimers.clearTimer,
    createRequestId: () => "forced",
    onExit: () => undefined,
  }).start();
  forcedChild.emit("message", readyMessage);
  forcedSignals.emit("SIGTERM");
  forcedSignals.emit("SIGTERM");
  assert.deepEqual(forcedChild.kills, ["SIGKILL"]);
  forcedChild.emit("exit", null, "SIGKILL");
});

test("an unexpected IPC disconnect gets a bounded parent-side fallback", () => {
  const child = new FakeChild();
  const signalProcess = new EventEmitter();
  const timers = createFakeTimers();
  new ServerSupervisor({
    child,
    signalProcess,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    createRequestId: () => "disconnect",
    onExit: () => undefined,
  }).start();

  child.connected = false;
  child.emit("disconnect");
  assert.deepEqual(child.kills, []);
  timers.timers[0].callback();
  assert.deepEqual(child.kills, ["SIGTERM"]);
  child.emit("exit", 0, null);
});

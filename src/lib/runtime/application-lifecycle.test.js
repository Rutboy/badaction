import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  ApplicationLifecycle,
  installApplicationLifecycleIpcHooks,
  installApplicationShutdownHooks,
  isApplicationLifecycleSupervised,
} from "./application-lifecycle.ts";
import {
  APPLICATION_LIFECYCLE_IPC_NAMESPACE,
  APPLICATION_LIFECYCLE_SUPERVISOR_ENV,
  createPrepareShutdownMessage,
} from "./application-lifecycle-protocol.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

class FakeIpcProcess extends EventEmitter {
  connected = true;
  sent = [];

  send(message, callback) {
    this.sent.push(message);
    callback?.(null);
    return true;
  }
}

test("application lifecycle starts cleanup once and drains cleanup plus listener", async () => {
  const cleanupShutdown = deferred();
  const listenerShutdown = deferred();
  let startCalls = 0;
  let cleanupShutdownCalls = 0;
  let listenerShutdownCalls = 0;
  const lifecycle = new ApplicationLifecycle({
    cleanupScheduler: {
      start: () => {
        startCalls += 1;
      },
      shutdown: () => {
        cleanupShutdownCalls += 1;
        return cleanupShutdown.promise;
      },
    },
    shutdownListener: () => {
      listenerShutdownCalls += 1;
      return listenerShutdown.promise;
    },
  });

  lifecycle.start();
  lifecycle.start();
  assert.equal(startCalls, 1);

  const firstShutdown = lifecycle.shutdown();
  const secondShutdown = lifecycle.shutdown();
  assert.equal(firstShutdown, secondShutdown);
  assert.equal(cleanupShutdownCalls, 1);
  assert.equal(listenerShutdownCalls, 1);

  cleanupShutdown.resolve();
  listenerShutdown.resolve();
  assert.equal(await firstShutdown, "complete");
});

test("SIGTERM hook initiates graceful lifecycle shutdown", async () => {
  const signalProcess = new EventEmitter();
  const events = [];
  let shutdownCalls = 0;
  installApplicationShutdownHooks(
    {
      shutdown: async () => {
        events.push("shutdown");
        shutdownCalls += 1;
        return "complete";
      },
    },
    signalProcess,
    () => events.push("draining"),
  );

  signalProcess.emit("SIGTERM");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(shutdownCalls, 1);
  assert.deepEqual(events, ["draining", "shutdown"]);
});

test("supervised lifecycle waits for shutdown before acknowledging IPC", async () => {
  const ipcProcess = new FakeIpcProcess();
  const shutdown = deferred();
  const events = [];
  let shutdownCalls = 0;
  installApplicationLifecycleIpcHooks(
    {
      shutdown: () => {
        events.push("shutdown");
        shutdownCalls += 1;
        return shutdown.promise;
      },
    },
    ipcProcess,
    { beginDraining: () => events.push("draining") },
  );

  assert.deepEqual(ipcProcess.sent, [
    {
      namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
      type: "lifecycle-ready",
    },
  ]);
  ipcProcess.emit("message", {
    namespace: "unrelated",
    type: "prepare-shutdown",
    requestId: "ignored",
  });
  ipcProcess.emit("message", createPrepareShutdownMessage("request-1"));
  assert.equal(shutdownCalls, 1);
  assert.deepEqual(events, ["draining", "shutdown"]);
  assert.equal(ipcProcess.sent.length, 1);

  shutdown.resolve("complete");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(ipcProcess.sent[1], {
    namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
    type: "shutdown-prepared",
    requestId: "request-1",
  });
});

test("IPC disconnect drains once before terminating the supervised child", async () => {
  const ipcProcess = new FakeIpcProcess();
  const shutdown = deferred();
  let shutdownCalls = 0;
  let terminateCalls = 0;
  installApplicationLifecycleIpcHooks(
    {
      shutdown: () => {
        shutdownCalls += 1;
        return shutdown.promise;
      },
    },
    ipcProcess,
    { terminate: () => (terminateCalls += 1) },
  );

  ipcProcess.emit("disconnect");
  ipcProcess.emit("disconnect");
  assert.equal(shutdownCalls, 1);
  assert.equal(terminateCalls, 0);
  shutdown.resolve("complete");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(terminateCalls, 1);
});

test("supervisor mode requires both the explicit env and a live IPC channel", () => {
  const env = { [APPLICATION_LIFECYCLE_SUPERVISOR_ENV]: "1" };
  assert.equal(
    isApplicationLifecycleSupervised(env, {
      connected: true,
      send: () => true,
    }),
    true,
  );
  assert.equal(
    isApplicationLifecycleSupervised(env, {
      connected: false,
      send: () => true,
    }),
    false,
  );
  assert.equal(
    isApplicationLifecycleSupervised(
      {},
      {
        connected: true,
        send: () => true,
      },
    ),
    false,
  );
});

test("application shutdown has a hard upper bound", async () => {
  let timeoutCallback;
  let timeoutDelay;
  let timeoutReports = 0;
  const lifecycle = new ApplicationLifecycle({
    cleanupScheduler: {
      start: () => undefined,
      shutdown: () => new Promise(() => undefined),
    },
    shutdownListener: () => new Promise(() => undefined),
    shutdownTimeoutMs: 25,
    setTimer: (callback, delayMs) => {
      timeoutCallback = callback;
      timeoutDelay = delayMs;
      return { unref: () => undefined };
    },
    clearTimer: () => undefined,
    onShutdownTimeout: () => {
      timeoutReports += 1;
    },
  });

  const shutdown = lifecycle.shutdown();
  assert.equal(timeoutDelay, 25);
  timeoutCallback();
  assert.equal(await shutdown, "timeout");
  assert.equal(timeoutReports, 1);
});

test("supervised lifecycle reports a timeout as failed preparation", async () => {
  const ipcProcess = new FakeIpcProcess();
  const shutdown = deferred();
  installApplicationLifecycleIpcHooks(
    { shutdown: () => shutdown.promise },
    ipcProcess,
  );

  ipcProcess.emit("message", createPrepareShutdownMessage("request-timeout"));
  shutdown.resolve("timeout");
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(ipcProcess.sent[1], {
    namespace: APPLICATION_LIFECYCLE_IPC_NAMESPACE,
    type: "shutdown-prepare-failed",
    requestId: "request-timeout",
  });
});

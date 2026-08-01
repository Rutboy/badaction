import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  BOARD_EVENT_CHANNEL,
} from "./board-events.ts";
import {
  PostgresBoardListener,
} from "./postgres-board-listener.ts";

const BOARD_A = "11111111-1111-4111-8111-111111111111";
const BOARD_B = "22222222-2222-4222-8222-222222222222";

class FakePgListenerClient extends EventEmitter {
  constructor({ connectError = null, queryError = null } = {}) {
    super();
    this.connectError = connectError;
    this.queryError = queryError;
    this.connectCalls = 0;
    this.queries = [];
    this.endCalls = 0;
  }

  async connect() {
    this.connectCalls += 1;
    if (this.connectError) {
      throw this.connectError;
    }
  }

  async query(queryText) {
    this.queries.push(queryText);
    if (this.queryError) {
      throw this.queryError;
    }
  }

  async end() {
    this.endCalls += 1;
  }
}

const notification = ({
  boardId = BOARD_A,
  revision = "1",
  type = "card.created",
  channel = BOARD_EVENT_CHANNEL,
  payload,
} = {}) => ({
  processId: 101,
  channel,
  payload: payload ?? JSON.stringify({ boardId, revision, type }),
});

const createFakeTimers = () => {
  const timers = [];
  const setTimer = (callback, delayMs) => {
    const timer = {
      callback,
      delayMs,
      cleared: false,
      fired: false,
    };
    timers.push(timer);
    return timer;
  };
  const clearTimer = (timer) => {
    timer.cleared = true;
  };
  const fireTimer = (timer) => {
    assert.equal(timer.cleared, false, "a cleared reconnect timer must not fire");
    assert.equal(timer.fired, false, "a reconnect timer must fire at most once");
    timer.fired = true;
    timer.callback();
  };

  return { timers, setTimer, clearTimer, fireTimer };
};

const flushBackgroundWork = () => new Promise((resolve) => setImmediate(resolve));

test("listener shares one connect and LISTEN across concurrent handshakes", async () => {
  const client = new FakePgListenerClient();
  let createClientCalls = 0;
  const listener = new PostgresBoardListener(() => {
    createClientCalls += 1;
    return client;
  });

  await Promise.all([
    listener.ensureListening(),
    listener.ensureListening(),
    listener.ensureListening(),
  ]);
  await listener.ensureListening();

  assert.equal(createClientCalls, 1);
  assert.equal(client.connectCalls, 1);
  assert.deepEqual(client.queries, [`LISTEN ${BOARD_EVENT_CHANNEL}`]);

  await listener.shutdown();
  assert.equal(client.endCalls, 1);
});

test("listener fans out only to the matching board and ignores invalid notifications", async () => {
  const client = new FakePgListenerClient();
  const listener = new PostgresBoardListener(() => client);
  await listener.ensureListening();

  const boardAEvents = [];
  const boardBEvents = [];
  const unsubscribeA = listener.subscribe(BOARD_A, {
    onEvent: (event) => boardAEvents.push(event),
    onUnavailable: () => undefined,
  });
  const unsubscribeB = listener.subscribe(BOARD_B, {
    onEvent: (event) => boardBEvents.push(event),
    onUnavailable: () => undefined,
  });

  client.emit("notification", notification());
  client.emit("notification", notification({ channel: "another_channel" }));
  client.emit("notification", notification({ payload: "{" }));
  client.emit("notification", notification({ payload: JSON.stringify({
    boardId: BOARD_A,
    revision: "2",
    type: "unknown.event",
  }) }));

  assert.deepEqual(boardAEvents, [{
    boardId: BOARD_A,
    revision: "1",
    type: "card.created",
  }]);
  assert.deepEqual(boardBEvents, []);

  unsubscribeA();
  unsubscribeB();
  await listener.shutdown();
});

test("a subscriber exception is isolated from the remaining board fanout", async () => {
  const client = new FakePgListenerClient();
  const listener = new PostgresBoardListener(() => client);
  await listener.ensureListening();

  let brokenSubscriberClosed = 0;
  const healthyEvents = [];
  const unsubscribeBroken = listener.subscribe(BOARD_A, {
    onEvent: () => {
      throw new Error("broken stream");
    },
    onUnavailable: () => {
      brokenSubscriberClosed += 1;
      throw new Error("broken cleanup");
    },
  });
  const unsubscribeHealthy = listener.subscribe(BOARD_A, {
    onEvent: (event) => healthyEvents.push(event),
    onUnavailable: () => undefined,
  });

  assert.doesNotThrow(() => {
    client.emit("notification", notification({ revision: "7", type: "vote.updated" }));
  });
  assert.equal(brokenSubscriberClosed, 1);
  assert.deepEqual(healthyEvents, [{
    boardId: BOARD_A,
    revision: "7",
    type: "vote.updated",
  }]);

  unsubscribeBroken();
  unsubscribeHealthy();
  await listener.shutdown();
});

test("disconnect closes subscribers and preserves exponential reconnect backoff", async () => {
  const timers = createFakeTimers();
  const clients = [
    new FakePgListenerClient(),
    new FakePgListenerClient({ connectError: new Error("database unavailable") }),
    new FakePgListenerClient(),
  ];
  let nextClient = 0;
  const listener = new PostgresBoardListener(
    () => {
      const client = clients[nextClient];
      nextClient += 1;
      if (!client) {
        throw new Error("unexpected listener connection");
      }
      return client;
    },
    timers.setTimer,
    timers.clearTimer,
  );
  await listener.ensureListening();

  let unavailableCalls = 0;
  let unsubscribe = () => undefined;
  unsubscribe = listener.subscribe(BOARD_A, {
    onEvent: () => undefined,
    onUnavailable: () => {
      unavailableCalls += 1;
      unsubscribe();
    },
  });

  clients[0].emit("end");

  assert.equal(unavailableCalls, 1);
  assert.equal(clients[0].endCalls, 1);
  assert.equal(timers.timers.length, 1);
  assert.equal(timers.timers[0].delayMs, 500);
  await assert.rejects(
    listener.ensureListening(),
    /waiting to reconnect/,
  );
  assert.equal(nextClient, 1, "a handshake must not bypass scheduled backoff");
  assert.equal(timers.timers[0].cleared, false);

  timers.fireTimer(timers.timers[0]);
  await flushBackgroundWork();

  assert.equal(nextClient, 2);
  assert.equal(clients[1].connectCalls, 1);
  assert.equal(clients[1].endCalls, 1);
  assert.equal(timers.timers.length, 2);
  assert.equal(timers.timers[1].delayMs, 1_000);
  await assert.rejects(
    listener.ensureListening(),
    /waiting to reconnect/,
  );
  assert.equal(nextClient, 2, "repeated handshakes must preserve exponential backoff");

  timers.fireTimer(timers.timers[1]);
  await flushBackgroundWork();
  await listener.ensureListening();

  assert.equal(nextClient, 3);
  assert.equal(clients[2].connectCalls, 1);
  assert.deepEqual(clients[2].queries, [`LISTEN ${BOARD_EVENT_CHANNEL}`]);

  await listener.shutdown();
  assert.equal(clients[2].endCalls, 1);
});

test("shutdown notifies streams, detaches client events, and ends once", async () => {
  const client = new FakePgListenerClient();
  const listener = new PostgresBoardListener(() => client);
  await listener.ensureListening();

  let unavailableCalls = 0;
  let deliveredEvents = 0;
  const unsubscribe = listener.subscribe(BOARD_A, {
    onEvent: () => {
      deliveredEvents += 1;
    },
    onUnavailable: () => {
      unavailableCalls += 1;
    },
  });

  await listener.shutdown();
  await listener.shutdown();

  assert.equal(unavailableCalls, 1);
  assert.equal(client.endCalls, 1);
  assert.equal(client.listenerCount("notification"), 0);
  assert.equal(client.listenerCount("error"), 0);
  assert.equal(client.listenerCount("end"), 0);
  client.emit("notification", notification());
  client.emit("end");
  assert.equal(deliveredEvents, 0);
  assert.equal(unavailableCalls, 1);
  await assert.rejects(listener.ensureListening(), /shutting down/);

  unsubscribe();
});

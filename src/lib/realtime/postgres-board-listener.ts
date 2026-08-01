import { Client, type Notification } from "pg";
import {
  BOARD_EVENT_CHANNEL,
  parseBoardMutationEvent,
  type BoardMutationEvent,
} from "./board-events.ts";

const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 30_000;

type Timer = ReturnType<typeof setTimeout>;

export type BoardEventSubscription = {
  onEvent: (event: BoardMutationEvent) => void;
  onUnavailable: () => void;
};

export interface PgListenerClient {
  connect(): Promise<unknown>;
  query(queryText: string): Promise<unknown>;
  end(): Promise<void>;
  on(event: "notification", listener: (message: Notification) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  off(event: "notification", listener: (message: Notification) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(event: "end", listener: () => void): unknown;
}

type ClientListeners = {
  notification: (message: Notification) => void;
  error: (error: Error) => void;
  end: () => void;
};

export class PostgresBoardListener {
  private readonly subscriptions = new Map<string, Set<BoardEventSubscription>>();
  private readonly clientListeners = new WeakMap<PgListenerClient, ClientListeners>();
  private readonly endedClients = new WeakSet<PgListenerClient>();
  private readonly createClient: () => PgListenerClient;
  private readonly setReconnectTimer: (
    callback: () => void,
    delayMs: number,
  ) => Timer;
  private readonly clearReconnectTimer: (timer: Timer) => void;
  private client: PgListenerClient | null = null;
  private connectPromise: Promise<void> | null = null;
  private reconnectTimer: Timer | null = null;
  private reconnectAttempt = 0;
  private shuttingDown = false;

  constructor(
    createClient: () => PgListenerClient,
    setReconnectTimer: (
      callback: () => void,
      delayMs: number,
    ) => Timer = setTimeout,
    clearReconnectTimer: (timer: Timer) => void = clearTimeout,
  ) {
    this.createClient = createClient;
    this.setReconnectTimer = setReconnectTimer;
    this.clearReconnectTimer = clearReconnectTimer;
  }

  async ensureListening(): Promise<void> {
    if (this.shuttingDown) {
      throw new Error("Board event listener is shutting down");
    }
    if (this.client && !this.connectPromise) {
      return;
    }
    if (this.reconnectTimer) {
      throw new Error("Board event listener is waiting to reconnect");
    }
    if (!this.connectPromise) {
      this.connectPromise = this.connect();
    }
    return this.connectPromise;
  }

  subscribe(
    boardId: string,
    subscription: BoardEventSubscription,
  ): () => void {
    const boardSubscriptions = this.subscriptions.get(boardId);
    if (boardSubscriptions) {
      boardSubscriptions.add(subscription);
    } else {
      this.subscriptions.set(boardId, new Set([subscription]));
    }

    let subscribed = true;
    return () => {
      if (!subscribed) {
        return;
      }
      subscribed = false;
      const current = this.subscriptions.get(boardId);
      current?.delete(subscription);
      if (current?.size === 0) {
        this.subscriptions.delete(boardId);
      }
    };
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      this.clearReconnectTimer(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.notifyUnavailable();
    const client = this.client;
    this.client = null;
    if (client) {
      this.detachClient(client);
      await this.endClient(client);
    }
    await this.connectPromise?.catch(() => undefined);
  }

  private async connect(): Promise<void> {
    const client = this.createClient();
    this.client = client;
    this.attachClient(client);
    try {
      await client.connect();
      if (this.shuttingDown || this.client !== client) {
        throw new Error("Board event listener connection was superseded");
      }
      await client.query(`LISTEN ${BOARD_EVENT_CHANNEL}`);
      if (this.shuttingDown || this.client !== client) {
        throw new Error("Board event listener connection was superseded");
      }
      this.reconnectAttempt = 0;
    } catch (error) {
      if (this.client === client) {
        this.client = null;
      }
      this.detachClient(client);
      await this.endClient(client);
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
      throw error;
    } finally {
      this.connectPromise = null;
    }
  }

  private attachClient(client: PgListenerClient): void {
    const listeners: ClientListeners = {
      notification: (message) => this.handleNotification(message),
      error: () => this.handleDisconnect(client),
      end: () => this.handleDisconnect(client),
    };
    this.clientListeners.set(client, listeners);
    client.on("notification", listeners.notification);
    client.on("error", listeners.error);
    client.on("end", listeners.end);
  }

  private detachClient(client: PgListenerClient): void {
    const listeners = this.clientListeners.get(client);
    if (!listeners) {
      return;
    }
    client.off("notification", listeners.notification);
    client.off("error", listeners.error);
    client.off("end", listeners.end);
    this.clientListeners.delete(client);
  }

  private handleNotification(message: Notification): void {
    if (message.channel !== BOARD_EVENT_CHANNEL || message.payload === undefined) {
      return;
    }
    const event = parseBoardMutationEvent(message.payload);
    if (!event) {
      return;
    }
    for (const subscription of this.subscriptions.get(event.boardId) ?? []) {
      try {
        subscription.onEvent(event);
      } catch {
        try {
          subscription.onUnavailable();
        } catch {
          // A broken subscriber must not disrupt fanout to other streams.
        }
      }
    }
  }

  private handleDisconnect(client: PgListenerClient): void {
    if (this.client !== client) {
      return;
    }
    this.client = null;
    this.detachClient(client);
    void this.endClient(client);
    this.notifyUnavailable();
    if (!this.shuttingDown) {
      this.scheduleReconnect();
    }
  }

  private notifyUnavailable(): void {
    const subscriptions = Array.from(this.subscriptions.values())
      .flatMap((boardSubscriptions) => Array.from(boardSubscriptions));
    for (const subscription of subscriptions) {
      try {
        subscription.onUnavailable();
      } catch {
        // Stream cleanup is isolated per subscriber.
      }
    }
  }

  private async endClient(client: PgListenerClient): Promise<void> {
    if (this.endedClients.has(client)) {
      return;
    }
    this.endedClients.add(client);
    await client.end().catch(() => undefined);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.shuttingDown) {
      return;
    }
    const delayMs = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = this.setReconnectTimer(() => {
      this.reconnectTimer = null;
      void this.ensureListening().catch(() => undefined);
    }, delayMs);
  }
}

const createPostgresClient = (): PgListenerClient => new Client({
  connectionString: process.env.DATABASE_URL,
  application_name: "badaction-realtime-listener",
  connectionTimeoutMillis: 10_000,
  keepAlive: true,
});

const globalForBoardListener = globalThis as typeof globalThis & {
  postgresBoardListener?: PostgresBoardListener;
};

export const getPostgresBoardListener = (): PostgresBoardListener => {
  const listener = globalForBoardListener.postgresBoardListener
    ?? new PostgresBoardListener(createPostgresClient);
  globalForBoardListener.postgresBoardListener = listener;
  return listener;
};

export const shutdownPostgresBoardListener = async (): Promise<void> => {
  await globalForBoardListener.postgresBoardListener?.shutdown();
};

import type { HubConnection } from '@microsoft/signalr';
import { create } from 'zustand';
import { apiClient } from '@/services/api/client';
import { getServerConfig } from '@/db/database';
import { log } from '@/utils/logger';

/**
 * SignalR hubs of TelegramFileManager (`/hubs/events`, `/hubs/transfers`).
 *
 * A hub connects while something holds it ({@link ServerHub.acquire}) and the
 * page is visible, and disconnects otherwise: nothing on screen needs live
 * events with the screen off, and an idle socket is not worth the battery.
 * Every user of a hub keeps a slower fallback (polling) for when it is not
 * connected, so a server without hubs, a proxy that blocks them or a CORS
 * policy that refuses them only costs liveness, never features.
 *
 * The client library is loaded on first use, outside the startup bundle.
 */

export type HubStatus = 'off' | 'connecting' | 'connected' | 'reconnecting';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (...args: any[]) => void;

let signalrModule: Promise<typeof import('@microsoft/signalr')> | null = null;
function loadSignalR() {
  signalrModule ??= import('@microsoft/signalr').catch((error) => {
    signalrModule = null;
    throw error;
  });
  return signalrModule;
}

export class ServerHub {
  readonly useStatus = create<{ status: HubStatus }>(() => ({ status: 'off' }));
  private connection: HubConnection | null = null;
  private starting: Promise<void> | null = null;
  private holders = 0;
  private handlers = new Map<string, Set<Handler>>();
  private connectedListeners = new Set<() => void>();
  private visibilityBound = false;
  private generation = 0;

  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  get status(): HubStatus {
    return this.useStatus.getState().status;
  }

  get connected(): boolean {
    return this.status === 'connected';
  }

  /** Keeps the hub connected (while visible) until the returned function is called. */
  acquire(): () => void {
    this.holders++;
    this.bindVisibility();
    void this.sync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holders--;
      void this.sync();
    };
  }

  /** Subscribes to a server message; returns the unsubscribe function. */
  on(event: string, handler: Handler): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
      this.connection?.on(event, (...args: unknown[]) => this.dispatch(event, args));
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  /** Called on every (re)connection: the moment to resync what may have been missed. */
  onConnected(listener: () => void): () => void {
    this.connectedListeners.add(listener);
    return () => {
      this.connectedListeners.delete(listener);
    };
  }

  /** Invokes a hub method when connected (null otherwise). */
  async invoke<T>(method: string, ...args: unknown[]): Promise<T | null> {
    if (!this.connection || !this.connected) return null;
    try {
      return (await this.connection.invoke(method, ...args)) as T;
    } catch (error) {
      log.warn(`Hub ${this.path}: ${method} failed`, error);
      return null;
    }
  }

  /** Drops the connection (server settings changed); holders reconnect to the new one. */
  reset(): void {
    this.generation++;
    void this.stopConnection().then(() => this.sync());
  }

  private dispatch(event: string, args: unknown[]): void {
    this.handlers.get(event)?.forEach((handler) => {
      try {
        handler(...args);
      } catch (error) {
        log.warn(`Hub ${this.path}: handler of ${event} failed`, error);
      }
    });
  }

  private setStatus(status: HubStatus): void {
    if (this.status !== status) this.useStatus.setState({ status });
  }

  private bindVisibility(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    this.visibilityBound = true;
    document.addEventListener('visibilitychange', () => void this.sync());
    window.addEventListener('online', () => void this.sync());
  }

  private wanted(): boolean {
    const visible = typeof document === 'undefined' || !document.hidden;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    return this.holders > 0 && visible && online;
  }

  private async sync(): Promise<void> {
    if (this.wanted()) {
      if (!this.connection && !this.starting) {
        this.starting = this.startConnection().finally(() => {
          this.starting = null;
        });
      }
    } else if (this.connection) {
      await this.stopConnection();
    }
  }

  private async startConnection(): Promise<void> {
    const generation = this.generation;
    const config = await getServerConfig();
    if (!config) return;
    this.setStatus('connecting');
    try {
      const signalR = await loadSignalR();
      const base = `${config.useHttps ? 'https' : 'http'}://${config.host}:${config.port}`;
      // The key goes in the URL (negotiate and the WebSocket handshake can't
      // carry our header everywhere) and as the header on plain HTTP requests
      const url = `${base}${this.path}?access_token=${encodeURIComponent(config.apiKey)}`;
      const connection = new signalR.HubConnectionBuilder()
        .withUrl(url, { headers: { 'X-API-Key': config.apiKey }, withCredentials: false })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.None)
        .build();

      for (const event of this.handlers.keys()) {
        connection.on(event, (...args: unknown[]) => this.dispatch(event, args));
      }
      connection.onreconnecting(() => this.setStatus('reconnecting'));
      connection.onreconnected(() => {
        this.setStatus('connected');
        this.connectedListeners.forEach((l) => l());
      });
      connection.onclose(() => {
        if (this.connection === connection) {
          this.connection = null;
          this.setStatus('off');
          // Gave up reconnecting: try again later (visibility, network back)
        }
      });

      this.connection = connection;
      await connection.start();
      if (generation !== this.generation || !this.wanted()) {
        await this.stopConnection();
        return;
      }
      this.setStatus('connected');
      log.debug(`Hub ${this.path} connected`);
      this.connectedListeners.forEach((l) => l());
    } catch (error) {
      log.warn(`Hub ${this.path} unavailable, falling back to polling`, error);
      this.connection = null;
      this.setStatus('off');
    }
  }

  private async stopConnection(): Promise<void> {
    const connection = this.connection;
    this.connection = null;
    this.setStatus('off');
    if (connection) {
      try {
        await connection.stop();
      } catch {
        // already closed
      }
    }
  }
}

/** Notifications, channel refresh, imports, deletes, player data (`events.hub`). */
export const eventsHub = new ServerHub('/hubs/events');
/** Transfers snapshot and summary. */
export const transfersHub = new ServerHub('/hubs/transfers');

apiClient.onReset(() => {
  eventsHub.reset();
  transfersHub.reset();
});

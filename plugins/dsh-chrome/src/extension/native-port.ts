import type { ExtensionMessage } from '../protocol/connector.ts';

const FIRST_RETRY_MS = 500;
/**
 * Below the 30 seconds after which Chrome may stop an idle service worker: a timer does
 * not keep the worker alive, but each attempt does, so a retrying worker keeps running.
 */
const LAST_RETRY_MS = 20_000;
/** How long the port retries on its own after the host it reached went away. */
const RETRY_PERIOD_MS = 5 * 60_000;

export interface NativePortHandlers {
  /** The port opened: the relay is running. Say hello here. */
  readonly onOpen: () => void;
  readonly onMessage: (message: unknown) => void;
}

/**
 * The connector's native messaging port, kept open for as long as the extension runs.
 *
 * Chrome starts a relay for every connection; the relay exits when the host plugin is
 * not running. When a host the port had reached goes away (DSH restarting), the port
 * retries with a growing delay for a few minutes, so it is back within seconds of DSH.
 * Otherwise it tries once whenever it is opened, which the service worker does when it
 * starts and on a periodic alarm: a host that was not running is found within a minute
 * of starting, without a relay started every few seconds while DSH is not in use.
 * An open port also keeps the service worker alive.
 */
export class NativePort {
  readonly #hostName: string;
  readonly #handlers: NativePortHandlers;
  #port: chrome.runtime.Port | null = null;
  /** Whether the open port reached a host, which answered its hello. */
  #reachedHost = false;
  /** Until when the port retries on its own, while it does. */
  #retryUntil: number | undefined;
  #retryDelay = FIRST_RETRY_MS;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(hostName: string, handlers: NativePortHandlers) {
    this.#hostName = hostName;
    this.#handlers = handlers;
  }

  /** Connects, unless the port is open already. */
  open(): void {
    if (this.#port !== null) return;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
    const port = chrome.runtime.connectNative(this.#hostName);
    this.#port = port;
    port.onMessage.addListener((message: unknown) => this.#handlers.onMessage(message));
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it as handled; the reason is only diagnostic.
      void chrome.runtime.lastError;
      this.#port = null;
      if (this.#reachedHost) {
        this.#reachedHost = false;
        this.#retryUntil = Date.now() + RETRY_PERIOD_MS;
        this.#retryDelay = FIRST_RETRY_MS;
      }
      if (this.#retryUntil === undefined || Date.now() >= this.#retryUntil) return;
      this.#retryTimer = setTimeout(() => this.open(), this.#retryDelay);
      this.#retryDelay = Math.min(this.#retryDelay * 2, LAST_RETRY_MS);
    });
    this.#handlers.onOpen();
  }

  /** The host answered the port's hello. */
  confirmHost(): void {
    this.#reachedHost = true;
    this.#retryUntil = undefined;
  }

  /** Sends a message if the port is open; messages sent while it is closed are dropped. */
  send(message: ExtensionMessage): void {
    this.#port?.postMessage(message);
  }
}

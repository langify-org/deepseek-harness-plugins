import type { ExtensionMessage } from '../protocol/connector.ts';

const FIRST_RETRY_MS = 500;
const LAST_RETRY_MS = 30_000;

export interface NativePortHandlers {
  /** The port opened: the relay is running. Say hello here. */
  readonly onOpen: () => void;
  readonly onMessage: (message: unknown) => void;
}

/**
 * The connector's native messaging port, kept open for as long as the extension runs.
 *
 * Chrome starts a relay for every connection; the relay exits when the host plugin is
 * not running, so the port reconnects with a growing delay until the host answers.
 * An open port also keeps the service worker alive.
 */
export class NativePort {
  readonly #hostName: string;
  readonly #handlers: NativePortHandlers;
  #port: chrome.runtime.Port | null = null;
  #retryDelay = FIRST_RETRY_MS;

  constructor(hostName: string, handlers: NativePortHandlers) {
    this.#hostName = hostName;
    this.#handlers = handlers;
  }

  open(): void {
    const port = chrome.runtime.connectNative(this.#hostName);
    this.#port = port;
    port.onMessage.addListener((message: unknown) => this.#handlers.onMessage(message));
    port.onDisconnect.addListener(() => {
      // Reading lastError marks it as handled; the reason is only diagnostic.
      void chrome.runtime.lastError;
      this.#port = null;
      setTimeout(() => this.open(), this.#retryDelay);
      this.#retryDelay = Math.min(this.#retryDelay * 2, LAST_RETRY_MS);
    });
    this.#handlers.onOpen();
  }

  /** The host answered: a later disconnect starts retrying from the shortest delay. */
  confirmHost(): void {
    this.#retryDelay = FIRST_RETRY_MS;
  }

  /** Sends a message if the port is open; messages sent while it is closed are dropped. */
  send(message: ExtensionMessage): void {
    this.#port?.postMessage(message);
  }
}

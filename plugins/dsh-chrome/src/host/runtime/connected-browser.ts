import type { Socket } from 'node:net';
import {
  type ConnectorErrorCode,
  type ConnectorMethod,
  type ConnectorParams,
  type ExtensionMessage,
  type JsonObject,
  MAX_HOST_TO_EXTENSION_BYTES,
  type PageEndReason,
  type PageGroup,
  type PageSnapshot,
  parsePageList,
  parsePageSnapshot,
  type RequestMessage,
  type TabId,
} from '../../protocol/connector.ts';
import type { CdpCommand } from './cdp.ts';
import { encodeFrame, frameBodyBytes } from './message-framing.ts';

/** Who a connected browser is. */
export interface BrowserIdentity {
  /**
   * The profile whose native host manifest started the relay. The plugin's installer
   * assigns it, so it can be trusted to tell the daily profile from a dedicated one.
   */
  readonly profile: string;
  /** The id the connector minted for its Chrome profile. */
  readonly browserId: string;
  readonly label: string;
  readonly extensionVersion: string;
}

/** What a connected browser reports on its own, outside any request. */
export type BrowserEvent =
  | {
      readonly type: 'cdp-event';
      readonly tabId: TabId;
      readonly method: string;
      readonly params: unknown;
    }
  | { readonly type: 'page-changed'; readonly page: PageSnapshot }
  | { readonly type: 'page-ended'; readonly tabId: TabId; readonly reason: PageEndReason };

export type ConnectorRequestFailure =
  | ConnectorErrorCode
  /** The browser disconnected before answering. */
  | 'disconnected'
  /** The browser did not answer in time. */
  | 'timeout'
  /** The request would exceed Chrome's message limit, so it was not sent. */
  | 'too-large'
  /** The browser answered with a result this protocol does not define. */
  | 'invalid-result';

export class ConnectorRequestError extends Error {
  readonly code: ConnectorRequestFailure;

  constructor(code: ConnectorRequestFailure, message: string) {
    super(message);
    this.name = 'ConnectorRequestError';
    this.code = code;
  }
}

export interface RequestOptions {
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * One Chrome profile connected through its connector. Requests are answered in any
 * order and matched by id; events arrive between them.
 */
export class ConnectedBrowser {
  readonly identity: BrowserIdentity;
  readonly #socket: Socket;
  readonly #pending = new Map<number, PendingRequest>();
  /** Requests the host stopped waiting for, by id: what to do with a late result. */
  readonly #lateResults = new Map<number, (result: unknown) => void>();
  readonly #eventListeners = new Set<(event: BrowserEvent) => void>();
  readonly #closeListeners = new Set<() => void>();
  #nextId = 1;
  #closed = false;

  constructor(socket: Socket, identity: BrowserIdentity) {
    this.#socket = socket;
    this.identity = identity;
    socket.once('close', () => this.#markClosed());
  }

  get closed(): boolean {
    return this.#closed;
  }

  /**
   * Opens a page. If the host stops waiting (a timeout, an abort) before the connector
   * answers, the tab it opens anyway is closed when the answer comes: an unknown tab would
   * stay under the connector's control and join the session after the next reconnect.
   */
  async openPage(url: string, group: PageGroup, options?: RequestOptions): Promise<PageSnapshot> {
    const closeLateTab = (result: unknown) => {
      const page = parsePageSnapshot(result);
      if (page !== undefined) void this.closePage(page.tabId).catch(() => {});
    };
    return requireSnapshot(await this.#request('page.open', { url, group }, options, closeLateTab));
  }

  async closePage(tabId: TabId, options?: RequestOptions): Promise<void> {
    await this.#request('page.close', { tabId }, options);
  }

  async activatePage(tabId: TabId, options?: RequestOptions): Promise<void> {
    await this.#request('page.activate', { tabId }, options);
  }

  async listPages(options?: RequestOptions): Promise<PageSnapshot[]> {
    const pages = parsePageList(await this.#request('page.list', {}, options));
    if (pages === undefined) throw invalidResult('page list');
    return pages;
  }

  sendCdp(
    tabId: TabId,
    method: CdpCommand,
    params: object,
    options?: RequestOptions,
  ): Promise<unknown> {
    // CDP parameter types are interfaces without index signatures, but every one of
    // them is a plain JSON object.
    return this.#request('cdp.send', { tabId, method, params: params as JsonObject }, options);
  }

  onEvent(listener: (event: BrowserEvent) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  /** Runs once the connection ends; immediately if it already has. */
  onClose(listener: () => void): () => void {
    if (this.#closed) {
      listener();
      return () => {};
    }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  disconnect(): void {
    this.#socket.destroy();
  }

  /** Takes one message from the connector after the handshake. */
  receive(message: ExtensionMessage): void {
    switch (message.type) {
      case 'response': {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) {
          // The host stopped waiting for it; some requests still have to clean up.
          const late = this.#lateResults.get(message.id);
          this.#lateResults.delete(message.id);
          if (late !== undefined && message.ok) late(message.result);
          return;
        }
        this.#pending.delete(message.id);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new ConnectorRequestError(message.error.code, message.error.message));
        return;
      }
      case 'cdp-event':
      case 'page-changed':
      case 'page-ended':
        for (const listener of this.#eventListeners) listener(message);
        return;
      case 'hello':
        // A connector says hello once, during the handshake.
        this.disconnect();
        return;
    }
  }

  #request<M extends ConnectorMethod>(
    method: M,
    params: ConnectorParams<M>,
    options: RequestOptions = {},
    onLateResult?: (result: unknown) => void,
  ): Promise<unknown> {
    if (this.#closed) {
      return Promise.reject(new ConnectorRequestError('disconnected', 'the browser disconnected'));
    }
    const id = this.#nextId++;
    const request: RequestMessage<M> = { type: 'request', id, method, params };
    const frame = encodeFrame(request);
    if (frameBodyBytes(frame) > MAX_HOST_TO_EXTENSION_BYTES) {
      return Promise.reject(
        new ConnectorRequestError(
          'too-large',
          `${method} is ${frameBodyBytes(frame)} bytes; Chrome accepts at most ${MAX_HOST_TO_EXTENSION_BYTES}`,
        ),
      );
    }
    const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    return new Promise((resolve, reject) => {
      const settle = () => {
        this.#pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const giveUp = (reason: unknown) => {
        settle();
        if (onLateResult !== undefined) this.#lateResults.set(id, onLateResult);
        reject(reason);
      };
      const onAbort = () => giveUp(signal?.reason);
      const timer = setTimeout(
        () =>
          giveUp(
            new ConnectorRequestError('timeout', `${method} got no answer in ${timeoutMs} ms`),
          ),
        timeoutMs,
      );
      if (signal?.aborted) {
        // Never sent, so no answer will come.
        settle();
        reject(signal.reason);
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.#pending.set(id, {
        resolve: (result) => {
          settle();
          resolve(result);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });
      this.#socket.write(frame);
    });
  }

  #markClosed(): void {
    if (this.#closed) return;
    this.#closed = true;
    const failure = new ConnectorRequestError('disconnected', 'the browser disconnected');
    for (const pending of [...this.#pending.values()]) pending.reject(failure);
    this.#pending.clear();
    this.#lateResults.clear();
    for (const listener of this.#closeListeners) listener();
    this.#closeListeners.clear();
    this.#eventListeners.clear();
  }
}

function requireSnapshot(value: unknown): PageSnapshot {
  const page = parsePageSnapshot(value);
  if (page === undefined) throw invalidResult('page snapshot');
  return page;
}

function invalidResult(what: string): ConnectorRequestError {
  return new ConnectorRequestError('invalid-result', `the connector returned an invalid ${what}`);
}

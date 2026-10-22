import type { Log } from '../../platform/log.ts';
import {
  type CdpArgs,
  type CdpCommand,
  type CdpEventName,
  type CdpEventParams,
  type CdpResult,
  isCdpCommand,
} from './cdp-methods.ts';
import type { CdpTransport } from './pipe-transport.ts';

/** How long a command may take, unless it says otherwise. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CdpCallOptions {
  /** The session of the target the command is for; without one, the browser's. */
  readonly sessionId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly timeoutMs?: number | undefined;
}

export type CdpFailure =
  /** Chrome answered the command with an error. */
  | 'protocol'
  | 'timeout'
  /** The connection closed before the answer came. */
  | 'closed'
  /** The command is not one dsh-chrome uses (see cdp-methods.ts). */
  | 'refused';

export class CdpError extends Error {
  readonly failure: CdpFailure;

  constructor(failure: CdpFailure, message: string) {
    super(message);
    this.name = 'CdpError';
    this.failure = failure;
  }
}

type EventListener = (params: unknown, sessionId: string | undefined) => void;

interface PendingCommand {
  resolve(result: unknown): void;
  reject(error: unknown): void;
}

/**
 * A CDP connection to the browser: commands for it or for one of its targets' sessions, and
 * the events they send.
 *
 * A command ends when Chrome answers it, when it takes longer than its timeout, when its
 * signal aborts, or when the connection closes. A command whose signal has already aborted
 * is never sent, and an answer that no one waits for any more is dropped. A listener that
 * throws is reported, and the other listeners still hear the event.
 */
export class CdpConnection {
  readonly #transport: CdpTransport;
  readonly #log: Log;
  readonly #pending = new Map<number, PendingCommand>();
  readonly #listeners = new Map<string, Set<EventListener>>();
  readonly #closeListeners = new Set<(reason: Error) => void>();
  #nextId = 1;
  #closedBy: Error | undefined;

  constructor(transport: CdpTransport, log: Log) {
    this.#transport = transport;
    this.#log = log;
    transport.onMessage((message) => this.#receive(message));
    transport.onClose((reason) => this.#markClosed(reason));
  }

  get closed(): boolean {
    return this.#closedBy !== undefined;
  }

  send<M extends CdpCommand>(
    method: M,
    ...[params, options]: CdpArgs<M, CdpCallOptions>
  ): Promise<CdpResult<M>> {
    // Chrome defines the result's shape (see cdp-methods.ts); the plugin does not re-validate it.
    return this.#call(method, params ?? {}, options ?? {}) as Promise<CdpResult<M>>;
  }

  /** Listens to an event from the browser or any of its sessions; returns the unsubscribe. */
  on<E extends CdpEventName>(
    event: E,
    listener: (params: CdpEventParams<E>[0], sessionId: string | undefined) => void,
  ): () => void {
    let listeners = this.#listeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(event, listeners);
    }
    const wrapped = listener as EventListener;
    listeners.add(wrapped);
    return () => listeners.delete(wrapped);
  }

  /** Runs once the connection closes, with why; immediately if it already has. */
  onClose(listener: (reason: Error) => void): () => void {
    if (this.#closedBy !== undefined) {
      listener(this.#closedBy);
      return () => {};
    }
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  close(): void {
    this.#transport.close();
  }

  #call(method: string, params: object, options: CdpCallOptions): Promise<unknown> {
    if (!isCdpCommand(method)) {
      return Promise.reject(
        new CdpError('refused', `${method} is not among the CDP commands dsh-chrome uses`),
      );
    }
    if (this.#closedBy !== undefined) {
      return Promise.reject(new CdpError('closed', `${method}: ${this.#closedBy.message}`));
    }
    const { signal, sessionId, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
    // Never sent, so no answer will come.
    if (signal?.aborted) return Promise.reject(signal.reason);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const settle = () => {
        this.#pending.delete(id);
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        settle();
        reject(signal?.reason);
      };
      const timer = setTimeout(() => {
        settle();
        reject(new CdpError('timeout', `${method} got no answer in ${timeoutMs} ms`));
      }, timeoutMs);
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
      const message =
        sessionId === undefined ? { id, method, params } : { id, method, params, sessionId };
      this.#transport.send(JSON.stringify(message));
    });
  }

  #receive(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      this.#log.warn('dsh-chrome: dropped a CDP message that is not JSON');
      return;
    }
    if (typeof message !== 'object' || message === null) return;
    const { id, method, params, sessionId, result, error } = message as Record<string, unknown>;
    if (typeof id === 'number') {
      const pending = this.#pending.get(id);
      if (pending === undefined) return;
      if (error !== undefined) pending.reject(new CdpError('protocol', protocolMessage(error)));
      else pending.resolve(result);
      return;
    }
    if (typeof method !== 'string') return;
    for (const listener of [...(this.#listeners.get(method) ?? [])]) {
      try {
        listener(params, typeof sessionId === 'string' ? sessionId : undefined);
      } catch (failure) {
        this.#log.warn(`dsh-chrome: a listener of ${method} failed: ${String(failure)}`);
      }
    }
  }

  #markClosed(reason: Error): void {
    if (this.#closedBy !== undefined) return;
    this.#closedBy = reason;
    for (const pending of [...this.#pending.values()]) {
      pending.reject(new CdpError('closed', reason.message));
    }
    for (const listener of [...this.#closeListeners]) listener(reason);
    this.#closeListeners.clear();
  }
}

/** The text of a CDP error: its message, and the detail Chrome adds, if any. */
function protocolMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const { message, data } = error as { message?: unknown; data?: unknown };
  const text = typeof message === 'string' ? message : 'CDP error';
  return typeof data === 'string' && data !== '' ? `${text} (${data})` : text;
}

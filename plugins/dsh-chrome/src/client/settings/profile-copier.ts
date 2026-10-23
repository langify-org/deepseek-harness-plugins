import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import {
  decodeViewerEvent,
  type ProfileCopyStatus,
  type UserChromeProfileState,
  type ViewerRequest,
} from '../../protocol/viewer.ts';

/** Where the copy of a profile stands, as this page knows it. */
export type CopyPhase =
  | { readonly kind: 'idle' }
  /**
   * The page asked for a copy, and the host has not said how it goes yet. `after` is when the
   * copy the host told of when the page asked started, if it told of one: the copy asked for
   * is any other.
   */
  | { readonly kind: 'asked'; readonly directory: string; readonly after: number | undefined }
  /** As the host says: the last copy since dsh-chrome started, under way, done, or failed. */
  | { readonly kind: 'host'; readonly status: ProfileCopyStatus }
  /** The host refused to begin the copy. */
  | { readonly kind: 'refused'; readonly message: string }
  /**
   * The connection dropped, or went silent, while the page waited for a copy, which the host
   * carries on; the page connects again. The copy waited for is any but `after`, as asked.
   */
  | {
      readonly kind: 'connection-lost';
      readonly directory: string;
      readonly after: number | undefined;
    }
  /**
   * Connected again, the host knows of no copy the page waited for: it did not finish while the
   * page could see it, because dsh-chrome started anew, which stops a copy, or the request did
   * not reach the host.
   */
  | { readonly kind: 'unfinished'; readonly directory: string };

/** The profile the copy is of, while the page knows of one. */
export function directoryOf(phase: CopyPhase): string | undefined {
  switch (phase.kind) {
    case 'asked':
    case 'connection-lost':
    case 'unfinished':
      return phase.directory;
    case 'host':
      return phase.status.directory;
    default:
      return undefined;
  }
}

/** Whether the page waits for a copy to end: one it asked for, or one under way. */
export function isCopying(phase: CopyPhase): boolean {
  switch (phase.kind) {
    case 'asked':
    case 'connection-lost':
      return true;
    case 'host':
      return phase.status.kind !== 'copied' && phase.status.kind !== 'failed';
    default:
      return false;
  }
}

/**
 * The phase once the host said where its last copy stands, or that it knows of none: the
 * host's word is the page's, so that a page that missed how a copy went learns it.
 */
export function reconciledPhase(phase: CopyPhase, copy: ProfileCopyStatus | null): CopyPhase {
  switch (phase.kind) {
    case 'asked':
      // Until the host begins the copy asked for, the copy it tells of is the earlier one.
      return copy !== null && copy.startedAt !== phase.after
        ? { kind: 'host', status: copy }
        : phase;
    case 'connection-lost':
      return copy !== null && copy.startedAt !== phase.after
        ? { kind: 'host', status: copy }
        : { kind: 'unfinished', directory: phase.directory };
    default: {
      if (copy !== null) return { kind: 'host', status: copy };
      const directory = directoryOf(phase);
      return isCopying(phase) && directory !== undefined
        ? { kind: 'unfinished', directory }
        : phase;
    }
  }
}

/** The phase once the connection dropped, or went silent: a copy waited for is not known. */
function lostPhase(phase: CopyPhase): CopyPhase {
  if (phase.kind === 'asked') return { ...phase, kind: 'connection-lost' };
  if (phase.kind === 'host' && isCopying(phase)) {
    // The copy followed, or a later one: any the host tells of.
    return { kind: 'connection-lost', directory: phase.status.directory, after: undefined };
  }
  return phase;
}

export interface ProfileCopierSnapshot {
  /** The profiles of the user's own Chrome, once the host said; undefined until then. */
  readonly profiles: readonly UserChromeProfileState[] | undefined;
  /** Whether the user's Chrome runs. */
  readonly running: boolean;
  /** Why the profiles could not be read, if they could not. */
  readonly listError: string | undefined;
  readonly phase: CopyPhase;
}

export interface ProfileCopierOptions {
  /** How long to wait before connecting again after the given number of failed attempts. */
  readonly reconnectDelayMs?: (attempt: number) => number;
  /** How often, during a copy, the page looks whether the host went silent. */
  readonly checkEveryMs?: number;
  /** After how long without a word from the host, during a copy, the page asks again. */
  readonly askAfterMs?: number;
  /** After how long without a word from the host, during a copy, the page connects again. */
  readonly reconnectAfterMs?: number;
}

const OPEN = 1;
const NOT_CONNECTED = 'this page is not connected to DSH';

/** One second, doubling after each attempt that fails, up to ten. */
function backoff(attempt: number): number {
  return Math.min(10_000, 1000 * 2 ** attempt);
}

/**
 * The settings page's connection to the host, for copying a profile of the user's own Chrome
 * into dsh-chrome's. It asks for the user's profiles whenever it connects, and the host then
 * tells it where its last copy stands; it asks for a copy when the user confirms one.
 *
 * During a copy the host speaks a few times a second, or once per database it checks: a page
 * that hears nothing for a while asks again, and connects again when that goes unanswered, as
 * it does when the connection drops. A connection a proxy left half open, which no `close`
 * reports, recovers so.
 */
export class ProfileCopier {
  readonly #openSocket: () => ConnectionWebSocket;
  readonly #reconnectDelayMs: (attempt: number) => number;
  readonly #checkEveryMs: number;
  readonly #askAfterMs: number;
  readonly #reconnectAfterMs: number;
  readonly #listeners = new Set<() => void>();
  #socket: ConnectionWebSocket;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #silenceCheck: ReturnType<typeof setInterval> | undefined;
  /** When the host last said anything, on the connection open now. */
  #lastHeardAt = Date.now();
  /** When the last copy the host told of started, if it told of one. */
  #lastCopyStartedAt: number | undefined;
  #disposed = false;
  #snapshot: ProfileCopierSnapshot = {
    profiles: undefined,
    running: false,
    listError: undefined,
    phase: { kind: 'idle' },
  };

  constructor(openSocket: () => ConnectionWebSocket, options: ProfileCopierOptions = {}) {
    this.#openSocket = openSocket;
    this.#reconnectDelayMs = options.reconnectDelayMs ?? backoff;
    this.#checkEveryMs = options.checkEveryMs ?? 5000;
    this.#askAfterMs = options.askAfterMs ?? 10_000;
    this.#reconnectAfterMs = options.reconnectAfterMs ?? 20_000;
    this.#socket = this.#connect();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): ProfileCopierSnapshot => this.#snapshot;

  /** Asks again which profiles the user's Chrome has, and whether it runs. */
  refresh(): void {
    if (!this.#send({ type: 'user-chrome' })) this.#update({ listError: NOT_CONNECTED });
  }

  /** Replaces dsh-chrome's profile with a copy of the user's: the user confirmed it. */
  copy(directory: string): void {
    if (isCopying(this.#snapshot.phase)) return;
    this.#update({ phase: { kind: 'asked', directory, after: this.#lastCopyStartedAt } });
    if (!this.#send({ type: 'copy-profile', directory })) {
      this.#update({ phase: { kind: 'refused', message: NOT_CONNECTED } });
    }
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#reconnectTimer);
    clearInterval(this.#silenceCheck);
    this.#listeners.clear();
    this.#socket.close();
  }

  #connect(): ConnectionWebSocket {
    const socket = this.#openSocket();
    socket.addEventListener('open', () => {
      if (this.#socket !== socket) return;
      this.#lastHeardAt = Date.now();
      this.refresh();
    });
    socket.addEventListener('message', ({ data }) => {
      if (this.#socket !== socket || typeof data !== 'string') return;
      // A host that answers: the attempts to connect start over after the next drop.
      this.#reconnectAttempt = 0;
      this.#lastHeardAt = Date.now();
      const event = decodeViewerEvent(data);
      switch (event?.type) {
        case 'user-chrome':
          this.#update({ profiles: event.profiles, running: event.running, listError: undefined });
          return;
        case 'profile-copy':
          if (event.copy !== null) this.#lastCopyStartedAt = event.copy.startedAt;
          this.#update({ phase: reconciledPhase(this.#snapshot.phase, event.copy) });
          return;
        case 'failed':
          if (event.requestType === 'user-chrome') this.#update({ listError: event.message });
          // A copy that failed once begun says so as `profile-copy` too: keep what it said.
          else if (event.requestType === 'copy-profile' && this.#snapshot.phase.kind === 'asked') {
            this.#update({ phase: { kind: 'refused', message: event.message } });
          }
          return;
        default:
          return;
      }
    });
    socket.addEventListener('close', () => {
      if (this.#disposed || this.#socket !== socket) return;
      this.#update({ phase: lostPhase(this.#snapshot.phase) });
      const delay = this.#reconnectDelayMs(this.#reconnectAttempt);
      this.#reconnectAttempt += 1;
      this.#reconnectTimer = setTimeout(() => {
        if (!this.#disposed) this.#socket = this.#connect();
      }, delay);
    });
    return socket;
  }

  /** During a copy, asks again after a silence, and connects again after a longer one. */
  #checkSilence(): void {
    if (this.#socket.readyState !== OPEN) return;
    const silence = Date.now() - this.#lastHeardAt;
    if (silence < this.#askAfterMs) return;
    if (silence < this.#reconnectAfterMs) {
      this.refresh();
      return;
    }
    const silent = this.#socket;
    this.#update({ phase: lostPhase(this.#snapshot.phase) });
    this.#socket = this.#connect();
    silent.close();
  }

  /** Whether the request went out: a closed socket takes nothing, and the caller says so. */
  #send(request: ViewerRequest): boolean {
    if (this.#socket.readyState !== OPEN) return false;
    this.#socket.send(JSON.stringify(request));
    return true;
  }

  #update(change: Partial<ProfileCopierSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    // The silence is looked at only while a copy is waited for.
    if (isCopying(this.#snapshot.phase) && !this.#disposed) {
      this.#silenceCheck ??= setInterval(() => this.#checkSilence(), this.#checkEveryMs);
    } else if (this.#silenceCheck !== undefined) {
      clearInterval(this.#silenceCheck);
      this.#silenceCheck = undefined;
    }
    for (const listener of [...this.#listeners]) listener();
  }
}

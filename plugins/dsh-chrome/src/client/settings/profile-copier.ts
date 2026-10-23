import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import {
  decodeViewerEvent,
  type UserChromeProfileState,
  type ViewerRequest,
} from '../../protocol/viewer.ts';

/** Where the copy of a profile stands. */
export type CopyPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'copying'; readonly directory: string }
  | { readonly kind: 'copied'; readonly directory: string }
  | { readonly kind: 'failed'; readonly message: string }
  /** The connection closed during the copy: the host carries a copy on, so its outcome is unknown. */
  | { readonly kind: 'connection-lost'; readonly directory: string };

export interface ProfileCopierSnapshot {
  /** The profiles of the user's own Chrome, once the host said; undefined until then. */
  readonly profiles: readonly UserChromeProfileState[] | undefined;
  /** Whether the user's Chrome runs. */
  readonly running: boolean;
  /** Why the profiles could not be read, if they could not. */
  readonly listError: string | undefined;
  readonly phase: CopyPhase;
}

const OPEN = 1;
const NOT_CONNECTED = 'this page is not connected to DSH';

/**
 * The settings page's connection to the host, for copying a profile of the user's own Chrome
 * into dsh-chrome's: it asks for the user's profiles once connected, and for a copy when
 * the user confirms one.
 */
export class ProfileCopier {
  readonly #socket: ConnectionWebSocket;
  readonly #listeners = new Set<() => void>();
  #snapshot: ProfileCopierSnapshot = {
    profiles: undefined,
    running: false,
    listError: undefined,
    phase: { kind: 'idle' },
  };

  constructor(openSocket: () => ConnectionWebSocket) {
    this.#socket = openSocket();
    this.#socket.addEventListener('open', () => this.refresh());
    this.#socket.addEventListener('message', ({ data }) => {
      if (typeof data !== 'string') return;
      const event = decodeViewerEvent(data);
      switch (event?.type) {
        case 'user-chrome':
          this.#update({ profiles: event.profiles, running: event.running, listError: undefined });
          return;
        case 'profile-copied':
          this.#update({ phase: { kind: 'copied', directory: event.directory } });
          return;
        case 'failed':
          if (event.requestType === 'user-chrome') this.#update({ listError: event.message });
          else if (event.requestType === 'copy-profile') {
            this.#update({ phase: { kind: 'failed', message: event.message } });
          }
          return;
        default:
          return;
      }
    });
    this.#socket.addEventListener('close', () => {
      if (this.#snapshot.phase.kind === 'copying') {
        this.#update({
          phase: { kind: 'connection-lost', directory: this.#snapshot.phase.directory },
        });
      }
    });
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
    if (this.#snapshot.phase.kind === 'copying') return;
    this.#update({ phase: { kind: 'copying', directory } });
    if (!this.#send({ type: 'copy-profile', directory })) {
      this.#update({ phase: { kind: 'failed', message: NOT_CONNECTED } });
    }
  }

  dispose(): void {
    this.#listeners.clear();
    this.#socket.close();
  }

  /** Whether the request went out: a closed socket takes nothing, and the caller says so. */
  #send(request: ViewerRequest): boolean {
    if (this.#socket.readyState !== OPEN) return false;
    this.#socket.send(JSON.stringify(request));
    return true;
  }

  #update(change: Partial<ProfileCopierSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of [...this.#listeners]) listener();
  }
}

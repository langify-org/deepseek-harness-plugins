import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import {
  type ChromeStatus,
  decodeViewerEvent,
  type HelpAnswer,
  type HelpRequestState,
  type ViewerEvent,
  type ViewerRequest,
} from '../../protocol/viewer.ts';

export type ViewerConnectionState = 'connecting' | 'connected' | 'disconnected';

/** What the tab renders, besides the screen. */
export interface ViewerSnapshot {
  readonly connection: ViewerConnectionState;
  /** Whether Chrome runs, once the host told. */
  readonly chrome: ChromeStatus | undefined;
  /** Whether the screen follows this viewer's size. */
  readonly screenOwner: boolean;
  /** The agent's open request for the user's help, in this tab's session. */
  readonly help: HelpRequestState | undefined;
  /** A message for the user: why a request failed, or what happened. */
  readonly notice: string | undefined;
}

/** The text of the page the user is looking at, for the user's message. */
export interface PageTextDocument {
  readonly title: string;
  readonly url: string;
  /** Markdown. */
  readonly text: string;
}

export interface ViewerSessionOptions {
  readonly sessionId: string;
  readonly openSocket: () => ConnectionWebSocket;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10_000];
const PAGE_TEXT_TIMEOUT_MS = 30_000;
const OPEN = 1;

/**
 * One sidebar tab's control connection to dsh-chrome: whether Chrome runs, whether the
 * screen follows this tab's size, the session's requests for help, and what the user asks
 * for besides input. React renders its snapshot; the screen travels over its own socket.
 *
 * When the socket drops (a sleeping laptop, a phone changing networks, DSH restarting) the
 * session connects again with a growing delay, and tells the host its size again.
 *
 * Opening the tab starts Chrome, once: a Chrome the user closed stays closed while the tab
 * stays open, until the user asks for it again.
 */
export class ViewerSession {
  readonly #options: ViewerSessionOptions;
  readonly #listeners = new Set<() => void>();
  readonly #pendingTexts = new Map<string, (result: PageTextDocument | Error) => void>();
  #snapshot: ViewerSnapshot = {
    connection: 'connecting',
    chrome: undefined,
    screenOwner: false,
    help: undefined,
    notice: undefined,
  };
  #socket: ConnectionWebSocket | undefined;
  #area: { readonly width: number; readonly height: number } | undefined;
  /** Links to open once connected. */
  readonly #pendingOpens: string[] = [];
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether the tab has asked for Chrome, as it does when it first connects. */
  #askedForChrome = false;
  #disposed = false;

  constructor(options: ViewerSessionOptions) {
    this.#options = options;
    this.#connect();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): ViewerSnapshot => this.#snapshot;

  /** The tab's screen area, in CSS pixels. */
  setArea(width: number, height: number): void {
    if (this.#area?.width === width && this.#area.height === height) return;
    this.#area = { width, height };
    this.#send({ type: 'viewport', width, height });
  }

  /** The user works in this tab: the screen follows its size. */
  claimScreen(): void {
    if (this.#snapshot.screenOwner || this.#snapshot.connection !== 'connected') return;
    // Taken as granted at once, so that every key does not ask again; the host confirms.
    this.#update({ screenOwner: true });
    this.#send({ type: 'claim-screen' });
  }

  /** Opens a page for the session, in front. */
  open(url: string): void {
    if (this.#snapshot.connection === 'connected') this.#send({ type: 'open', url });
    else this.#pendingOpens.push(url);
  }

  startChrome(): void {
    this.#send({ type: 'start-chrome' });
  }

  answerHelp(answer: HelpAnswer): void {
    const help = this.#snapshot.help;
    if (help === undefined) return;
    this.#send({ type: 'answer-help', requestId: help.id, answer });
  }

  /** Reads the text of the page the user is looking at. */
  readText(): Promise<PageTextDocument> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingTexts.delete(requestId);
        reject(new Error('the page text did not arrive in time'));
      }, PAGE_TEXT_TIMEOUT_MS);
      this.#pendingTexts.set(requestId, (result) => {
        clearTimeout(timer);
        this.#pendingTexts.delete(requestId);
        if (result instanceof Error) reject(result);
        else resolve(result);
      });
      this.#send({ type: 'read-text', requestId });
    });
  }

  /** Shows a message to the user in the tab. */
  notify(notice: string | undefined): void {
    this.#update({ notice });
  }

  /** Connects now, after the automatic attempts gave up or the user asked. */
  reconnect(): void {
    clearTimeout(this.#reconnectTimer);
    this.#reconnectAttempt = 0;
    this.#connect();
  }

  dispose(): void {
    this.#disposed = true;
    clearTimeout(this.#reconnectTimer);
    this.#socket?.close();
    this.#failPendingTexts(new Error('the tab closed'));
    this.#listeners.clear();
  }

  #connect(): void {
    this.#socket?.close();
    this.#update({ connection: 'connecting', screenOwner: false });
    const socket = this.#options.openSocket();
    this.#socket = socket;
    socket.addEventListener('open', () => {
      if (this.#socket !== socket) return;
      this.#reconnectAttempt = 0;
      // The host takes requests only from a viewer that watches a session: watch first.
      this.#send({ type: 'watch', sessionId: this.#options.sessionId });
      if (this.#area !== undefined) this.#send({ type: 'viewport', ...this.#area });
      for (const url of this.#pendingOpens.splice(0)) this.#send({ type: 'open', url });
      if (!this.#askedForChrome) {
        this.#askedForChrome = true;
        this.#send({ type: 'start-chrome' });
      }
      this.#update({ connection: 'connected' });
    });
    socket.addEventListener('message', ({ data }) => {
      if (this.#socket !== socket || typeof data !== 'string') return;
      const event = decodeViewerEvent(data);
      if (event !== undefined) this.#receive(event);
    });
    socket.addEventListener('close', () => {
      if (this.#disposed || this.#socket !== socket) return;
      this.#update({ connection: 'disconnected', screenOwner: false });
      this.#failPendingTexts(new Error('the connection to DSH was lost'));
      const delay = RECONNECT_DELAYS_MS[this.#reconnectAttempt];
      if (delay === undefined) return;
      this.#reconnectAttempt += 1;
      this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
    });
  }

  #receive(event: ViewerEvent): void {
    switch (event.type) {
      case 'chrome':
        this.#update({ chrome: event.status });
        return;
      case 'screen':
        this.#update({ screenOwner: event.owner });
        return;
      case 'help':
        this.#update({ help: event.request ?? undefined });
        return;
      case 'page-text':
        this.#pendingTexts.get(event.requestId)?.({
          title: event.title,
          url: event.url,
          text: event.text,
        });
        return;
      case 'failed': {
        const reader =
          event.requestType === 'read-text' && event.requestId !== null
            ? this.#pendingTexts.get(event.requestId)
            : undefined;
        // Whoever asked for the text reports its failure.
        if (reader !== undefined) reader(new Error(event.message));
        else this.#update({ notice: event.message });
        return;
      }
    }
  }

  #failPendingTexts(error: Error): void {
    for (const settle of [...this.#pendingTexts.values()]) settle(error);
  }

  #send(request: ViewerRequest): void {
    if (this.#socket?.readyState === OPEN) this.#socket.send(JSON.stringify(request));
  }

  #update(change: Partial<ViewerSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of [...this.#listeners]) listener();
  }
}

import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import type {
  FrameHeader,
  HelpAnswer,
  HelpRequestState,
  PageState,
  ViewerEvent,
  ViewerInput,
  ViewerRequest,
  Viewport,
} from '../../protocol/viewer.ts';
import { ViewerSocket } from './viewer-socket.ts';

export type ViewerStatus = 'connecting' | 'connected' | 'disconnected';

/** What the tab renders, besides the pixels. */
export interface ViewerSnapshot {
  readonly status: ViewerStatus;
  /** The page shown, once the host attached one. */
  readonly page: PageState | undefined;
  /** The session's pages, most recently used first. */
  readonly pages: readonly PageState[];
  /** The agent's open request for the user's help on the shown page. */
  readonly help: HelpRequestState | undefined;
  /** A message for the user: why a page ended, or why a request failed. */
  readonly notice: string | undefined;
}

export type FrameSink = (header: FrameHeader, image: Uint8Array<ArrayBuffer>) => void;

/** The shown page's text, for the user's message. */
export interface PageTextDocument {
  readonly title: string;
  readonly url: string;
  /** Markdown. */
  readonly text: string;
}

export interface ViewerSessionOptions {
  readonly sessionId: string;
  readonly openSocket: () => ConnectionWebSocket;
  /** The page to show again, remembered from an earlier view of this tab. */
  readonly rememberedPageId: string | undefined;
  /** Called with the shown page's id, or `undefined` when it ended, to remember it. */
  readonly rememberPage: (pageId: string | undefined) => void;
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 5000, 10_000];
const PAGE_TEXT_TIMEOUT_MS = 30_000;

/**
 * One sidebar tab's view of its session's Chrome pages: the viewer socket, what it shows,
 * and what the user asks for. React renders its snapshot; the surface draws its frames.
 *
 * A tab with no page of its own shows the session's most recently used page, and a tab
 * switches to a page that newly appears in the session (the agent opened it), so the user
 * sees what the agent is working on. When the socket drops (a sleeping laptop, a phone
 * changing networks) the session reconnects with a growing delay and shows the same page
 * again.
 */
export class ViewerSession {
  readonly #options: ViewerSessionOptions;
  readonly #listeners = new Set<() => void>();
  readonly #frameSinks = new Set<FrameSink>();
  readonly #pendingTexts = new Map<string, (result: PageTextDocument | Error) => void>();
  /** Pages that ended since the last page list, which may still appear in it. */
  readonly #endedPageIds = new Set<string>();
  /** The ids of the last page list, to notice newly opened pages; unknown before the first. */
  #knownPageIds: ReadonlySet<string> | undefined;
  #snapshot: ViewerSnapshot = {
    status: 'connecting',
    page: undefined,
    pages: [],
    help: undefined,
    notice: undefined,
  };
  #socket: ViewerSocket | undefined;
  #pageId: string | undefined;
  #pendingUrl: string | undefined;
  #viewport: Viewport = { width: 800, height: 600, deviceScaleFactor: 1 };
  #visible = true;
  #lastImage: Uint8Array<ArrayBuffer> | undefined;
  #reconnectAttempt = 0;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;

  constructor(options: ViewerSessionOptions) {
    this.#options = options;
    this.#pageId = options.rememberedPageId;
    this.#connect();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): ViewerSnapshot => this.#snapshot;

  /** Receives every frame; the surface draws them. */
  onFrame(sink: FrameSink): () => void {
    this.#frameSinks.add(sink);
    return () => this.#frameSinks.delete(sink);
  }

  /** The image of the last frame, as JPEG bytes. */
  get lastImage(): Uint8Array<ArrayBuffer> | undefined {
    return this.#lastImage;
  }

  /** Opens a new page for the session at `url` and shows it. */
  open(url: string): void {
    this.#pendingUrl = url;
    this.#update({ notice: undefined });
    this.#send({ type: 'open', url, viewport: this.#viewport });
  }

  /** Shows another page of the session. */
  show(pageId: string): void {
    this.#pageId = pageId;
    this.#send({ type: 'attach', pageId, viewport: this.#viewport });
  }

  navigate(url: string): void {
    this.#send({ type: 'navigate', url });
  }

  goBack(): void {
    this.#send({ type: 'history', delta: -1 });
  }

  goForward(): void {
    this.#send({ type: 'history', delta: 1 });
  }

  reload(): void {
    this.#send({ type: 'reload' });
  }

  closePage(): void {
    this.#send({ type: 'close-page' });
  }

  input(input: ViewerInput): void {
    this.#send({ type: 'input', input });
  }

  resize(viewport: Viewport): void {
    this.#viewport = viewport;
    if (this.#snapshot.page !== undefined) this.#send({ type: 'resize', viewport });
  }

  /** Whether the tab is on screen; a hidden tab receives no frames. */
  setVisible(visible: boolean): void {
    if (visible === this.#visible) return;
    this.#visible = visible;
    this.#send({ type: 'visibility', visible });
  }

  frameDrawn(seq: number): void {
    this.#send({ type: 'frame-drawn', seq });
  }

  answerHelp(answer: HelpAnswer): void {
    const help = this.#snapshot.help;
    if (help === undefined) return;
    this.#send({ type: 'answer-help', requestId: help.id, answer });
  }

  /** Reads the shown page's text from Chrome. */
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

  /** Reconnects now, after the automatic attempts gave up or the user asked. */
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
    this.#frameSinks.clear();
  }

  #connect(): void {
    this.#socket?.close();
    this.#update({ status: 'connecting' });
    const socket: ViewerSocket = new ViewerSocket(this.#options.openSocket(), {
      onOpen: () => {
        this.#reconnectAttempt = 0;
        this.#update({ status: 'connected' });
        this.#send({ type: 'watch', sessionId: this.#options.sessionId });
        if (!this.#visible) this.#send({ type: 'visibility', visible: false });
        if (this.#pageId !== undefined) this.show(this.#pageId);
        else if (this.#pendingUrl !== undefined) this.open(this.#pendingUrl);
      },
      onEvent: (event) => this.#receive(event),
      onFrame: (header, image) => {
        this.#lastImage = image;
        for (const sink of this.#frameSinks) sink(header, image);
      },
      onClose: () => {
        if (this.#disposed || this.#socket !== socket) return;
        this.#update({ status: 'disconnected' });
        this.#failPendingTexts(new Error('the connection to DSH was lost'));
        const delay = RECONNECT_DELAYS_MS[this.#reconnectAttempt];
        if (delay === undefined) return;
        this.#reconnectAttempt += 1;
        this.#reconnectTimer = setTimeout(() => this.#connect(), delay);
      },
    });
    this.#socket = socket;
  }

  #receive(event: ViewerEvent): void {
    switch (event.type) {
      case 'pages': {
        this.#endedPageIds.clear();
        const known = this.#knownPageIds;
        this.#knownPageIds = new Set(event.pages.map((page) => page.id));
        this.#update({ pages: event.pages });
        const opened =
          known === undefined ? undefined : event.pages.find((page) => !known.has(page.id));
        if (opened !== undefined && opened.id !== this.#pageId && this.#pendingUrl === undefined) {
          this.show(opened.id);
          return;
        }
        this.#showLatestIfIdle();
        return;
      }
      case 'attached':
        this.#pageId = event.page.id;
        this.#pendingUrl = undefined;
        this.#options.rememberPage(event.page.id);
        this.#update({ page: event.page, notice: undefined });
        return;
      case 'page':
        if (event.page.id === this.#pageId) this.#update({ page: event.page });
        return;
      case 'ended':
        if (this.#pageId !== undefined) this.#endedPageIds.add(this.#pageId);
        this.#pageId = undefined;
        this.#lastImage = undefined;
        this.#options.rememberPage(undefined);
        this.#update({ page: undefined, help: undefined, notice: endedNotice(event.reason) });
        this.#showLatestIfIdle();
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
        // No page will be attached for a failed open, so the tab follows the session again.
        if (event.requestType === 'open') this.#pendingUrl = undefined;
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

  /** A tab without a page of its own shows the session's most recently used page. */
  #showLatestIfIdle(): void {
    if (this.#pageId !== undefined || this.#pendingUrl !== undefined) return;
    const latest = this.#snapshot.pages.find((page) => !this.#endedPageIds.has(page.id));
    if (latest !== undefined) this.show(latest.id);
  }

  #failPendingTexts(error: Error): void {
    for (const settle of [...this.#pendingTexts.values()]) settle(error);
  }

  #send(request: ViewerRequest): void {
    this.#socket?.send(request);
  }

  #update(change: Partial<ViewerSnapshot>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    for (const listener of this.#listeners) listener();
  }
}

function endedNotice(reason: string): string {
  switch (reason) {
    case 'closed':
      return 'The page was closed.';
    case 'released-by-user':
      return 'Chrome stopped sharing the page (debugging was cancelled in Chrome).';
    case 'disconnected':
      return 'Chrome disconnected. Pages opened before are no longer shared.';
    default:
      return reason;
  }
}

import type { RawData, WebSocket } from 'ws';
import {
  type ChromeStatus,
  decodeViewerRequest,
  type ViewerEvent,
  type ViewerRequest,
} from '../../protocol/viewer.ts';
import type { ChromeService, ChromeState } from '../chrome/chrome-service.ts';
import { normalizeAddress } from '../page-operations/address.ts';
import { pageTextMarkdown, readPageText } from '../page-operations/text.ts';
import type { Log } from '../platform/log.ts';
import type { LayoutViewer, ScreenLayout, ViewerArea } from './screen-layout.ts';

/** The most page text a viewer may add to a message. */
const MAX_PAGE_TEXT_CHARS = 200_000;

export interface ViewerDependencies {
  readonly chrome: ChromeService;
  readonly layout: ScreenLayout;
  readonly log: Log;
}

/**
 * One viewer's control connection: a sidebar tab of one DSH session. It hears whether
 * Chrome runs, how the screen is laid out, and the session's requests for help; it gives
 * its size, claims the screen when the user works in it, and asks for pages and their text.
 * Its pixels and input travel over its screen connection.
 */
export class ViewerConnection implements LayoutViewer {
  readonly #socket: WebSocket;
  readonly #deps: ViewerDependencies;
  readonly #subscriptions: (() => void)[] = [];
  #sessionId: string | undefined;
  #area: ViewerArea | undefined;
  /** The request for help last sent, as JSON, so that only changes are sent. */
  #sentHelp: string | undefined;
  #closed = false;

  constructor(socket: WebSocket, deps: ViewerDependencies) {
    this.#socket = socket;
    this.#deps = deps;
    socket.on('message', (data, isBinary) => this.#receive(data, isBinary));
    socket.on('close', () => this.#close());
    socket.on('error', (error) =>
      deps.log.warn(`dsh-chrome: a viewer connection failed: ${error.message}`),
    );
  }

  get area(): ViewerArea | undefined {
    return this.#area;
  }

  ownerChanged(owner: boolean): void {
    this.#send({ type: 'screen', owner });
  }

  #receive(data: RawData, isBinary: boolean): void {
    const request = isBinary ? undefined : decodeViewerRequest(data.toString());
    if (request === undefined) {
      this.#send({
        type: 'failed',
        requestType: null,
        requestId: null,
        message: 'the viewer sent a request this protocol does not define',
      });
      return;
    }
    void this.#handle(request).catch((error: unknown) => {
      this.#send({
        type: 'failed',
        requestType: request.type,
        requestId: 'requestId' in request ? request.requestId : null,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async #handle(request: ViewerRequest): Promise<void> {
    const { chrome, layout } = this.#deps;
    switch (request.type) {
      case 'watch':
        this.#watch(request.sessionId);
        return;
      case 'viewport':
        this.#area = { width: request.width, height: request.height };
        layout.areaChanged(this);
        return;
      case 'claim-screen':
        layout.claim(this);
        return;
      case 'start-chrome':
        await chrome.chrome();
        return;
      case 'open': {
        const url = normalizeAddress(request.url);
        if (url === undefined) throw new Error(`"${request.url}" is not a web address`);
        await chrome.openPage(this.#requireSession(), url, { openedBy: 'user' });
        return;
      }
      case 'answer-help': {
        // Only the session's own request; the agent of another session waits for its own.
        const open = chrome.helpRequests.ofSession(this.#requireSession());
        if (open?.id !== request.requestId) throw new Error('that request is no longer open');
        chrome.helpRequests.answer(request.requestId, request.answer);
        return;
      }
      case 'read-text': {
        const page = await chrome.pages.pageInFront();
        if (page === undefined) throw new Error('Chrome shows no page');
        const text = await readPageText(page, MAX_PAGE_TEXT_CHARS);
        this.#send({
          type: 'page-text',
          requestId: request.requestId,
          title: text.title,
          url: text.url,
          text: pageTextMarkdown(text),
        });
        return;
      }
    }
  }

  #watch(sessionId: string): void {
    if (this.#sessionId !== undefined) throw new Error('this viewer already watches a session');
    if (this.#closed) return;
    this.#sessionId = sessionId;
    const { chrome, layout } = this.#deps;
    this.#subscriptions.push(
      chrome.onStateChange((state) => this.#send({ type: 'chrome', status: statusOf(state) })),
      chrome.helpRequests.onChange(() => this.#sendHelp()),
      chrome.pages.onChange(() => this.#sendHelp()),
    );
    this.#send({ type: 'chrome', status: statusOf(chrome.state) });
    this.#sendHelp();
    layout.add(this);
  }

  #requireSession(): string {
    if (this.#sessionId === undefined) throw new Error('watch a session first');
    return this.#sessionId;
  }

  /** The session's open request for help, with the page it is about. */
  #sendHelp(): void {
    const { chrome } = this.#deps;
    const request =
      this.#sessionId === undefined ? undefined : chrome.helpRequests.ofSession(this.#sessionId);
    const page = request === undefined ? undefined : chrome.page(request.pageId);
    const state =
      request === undefined
        ? null
        : {
            id: request.id,
            message: request.message,
            pageTitle: page?.title ?? '',
            pageUrl: page?.url ?? '',
          };
    const text = JSON.stringify(state);
    // Page changes are frequent; the viewer hears of the request only when it changed.
    if (text === this.#sentHelp) return;
    this.#sentHelp = text;
    this.#send({ type: 'help', request: state });
  }

  #close(): void {
    this.#closed = true;
    for (const unsubscribe of this.#subscriptions.splice(0)) unsubscribe();
    this.#deps.layout.remove(this);
  }

  #send(event: ViewerEvent): void {
    if (this.#socket.readyState === this.#socket.OPEN) this.#socket.send(JSON.stringify(event));
  }
}

function statusOf(state: ChromeState): ChromeStatus {
  switch (state.kind) {
    case 'running':
      return { kind: 'running', version: state.version };
    case 'failed':
      return { kind: 'failed', message: state.message };
    default:
      return { kind: state.kind };
  }
}

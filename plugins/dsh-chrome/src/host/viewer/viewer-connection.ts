import type { RawData, WebSocket } from 'ws';
import {
  type ChromeStatus,
  decodeViewerRequest,
  type ScreenRegion,
  type ViewerEvent,
  type ViewerRequest,
} from '../../protocol/viewer.ts';
import type { ChromeService, ChromeState } from '../chrome/chrome-service.ts';
import { normalizeAddress } from '../page-operations/address.ts';
import { pageTextMarkdown, readPageText } from '../page-operations/text.ts';
import type { Log } from '../platform/log.ts';
import type { ScreenOwnership, ScreenViewer, ViewerArea } from './screen-ownership.ts';

/** The most page text a viewer may add to a message. */
const MAX_PAGE_TEXT_CHARS = 200_000;

export interface ViewerDependencies {
  readonly chrome: ChromeService;
  /** The layout of a session's screen, made for its first viewer. */
  readonly ownershipOf: (sessionId: string) => ScreenOwnership;
  /** A viewer left the session's layout: it goes once none is left. */
  readonly ownershipLeft: (sessionId: string) => void;
  readonly log: Log;
}

/**
 * One viewer's control connection: a sidebar tab of one DSH session. It hears whether
 * Chrome runs, where the session's part of the screen is and whether the session has a
 * window, and the session's requests for help; it gives its size, claims the session's
 * screen when the user works in it, and asks for windows, pages and their text. Its pixels
 * and input travel over its screen connection.
 */
export class ViewerConnection implements ScreenViewer {
  readonly #socket: WebSocket;
  readonly #deps: ViewerDependencies;
  readonly #subscriptions: (() => void)[] = [];
  #sessionId: string | undefined;
  #ownership: ScreenOwnership | undefined;
  #owner = false;
  #area: ViewerArea | undefined;
  /** The screen event last sent, as JSON, so that only changes are sent. */
  #sentScreen: string | undefined;
  /** Whether the viewer last heard that the session has a window. */
  #sentWindows: boolean | undefined;
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
    this.#owner = owner;
    this.#sendScreen();
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
    const { chrome } = this.#deps;
    switch (request.type) {
      case 'watch':
        this.#watch(request.sessionId);
        return;
      case 'viewport':
        this.#area = { width: request.width, height: request.height };
        this.#ownership?.areaChanged(this);
        return;
      case 'claim-screen':
        this.#ownership?.claim(this);
        return;
      case 'open-window':
        await chrome.openWindow(this.#requireSession());
        return;
      case 'restart-chrome':
        await chrome.restartChrome();
        return;
      case 'user-chrome': {
        const { profiles, running } = await chrome.userChrome();
        this.#send({
          type: 'user-chrome',
          profiles: profiles.map(({ directory, name, account }) => ({
            directory,
            name,
            account: account ?? null,
          })),
          running,
        });
        return;
      }
      case 'copy-profile':
        await chrome.copyUserChromeProfile(request.directory);
        this.#send({ type: 'profile-copied', directory: request.directory });
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
        const page = await chrome.pages.pageInFront(this.#requireSession());
        if (page === undefined) throw new Error("the session's window shows no page");
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
    const { chrome, ownershipOf } = this.#deps;
    // Throws when the screen has no room for another session; the viewer hears why.
    const hide = chrome.showSession(sessionId);
    this.#sessionId = sessionId;
    this.#subscriptions.push(
      hide,
      chrome.onStateChange((state) => this.#send({ type: 'chrome', status: statusOf(state) })),
      chrome.helpRequests.onChange(() => this.#sendHelp()),
      chrome.pages.onChange(() => {
        this.#sendHelp();
        this.#sendWindows();
      }),
      chrome.screens.onChange(() => this.#sendScreen()),
    );
    this.#send({ type: 'chrome', status: statusOf(chrome.state) });
    this.#sendHelp();
    this.#sendWindows();
    this.#ownership = ownershipOf(sessionId);
    this.#ownership.add(this);
    this.#sendScreen();
  }

  /** Where the session's part of the screen is, and whether it follows this viewer. */
  #sendScreen(): void {
    if (this.#sessionId === undefined) return;
    const monitor = this.#deps.chrome.screens.monitorOf(this.#sessionId);
    const region: ScreenRegion | null =
      monitor === undefined
        ? null
        : { x: monitor.x, y: monitor.y, width: monitor.width, height: monitor.height };
    const event: ViewerEvent = { type: 'screen', owner: this.#owner, region };
    const text = JSON.stringify(event);
    if (text === this.#sentScreen) return;
    this.#sentScreen = text;
    this.#send(event);
  }

  /** Whether the session has a window. */
  #sendWindows(): void {
    if (this.#sessionId === undefined) return;
    const open = this.#deps.chrome.pages.ofSession(this.#sessionId).length > 0;
    if (open === this.#sentWindows) return;
    this.#sentWindows = open;
    this.#send({ type: 'windows', open });
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
    if (this.#sessionId !== undefined) {
      this.#ownership?.remove(this);
      this.#deps.ownershipLeft(this.#sessionId);
    }
  }

  #send(event: ViewerEvent): void {
    if (this.#socket.readyState === this.#socket.OPEN) this.#socket.send(JSON.stringify(event));
  }
}

function statusOf(state: ChromeState): ChromeStatus {
  switch (state.kind) {
    case 'running':
      return { kind: 'running', version: state.version, settingsChanged: state.settingsChanged };
    case 'failed':
      return { kind: 'failed', message: state.message };
    default:
      return { kind: state.kind };
  }
}

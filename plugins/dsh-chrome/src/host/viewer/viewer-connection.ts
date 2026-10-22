import type { RawData, WebSocket } from 'ws';
import { normalizeAddress } from '../../protocol/address.ts';
import {
  decodeViewerRequest,
  encodeFrame,
  type PageState,
  type ViewerEvent,
  type ViewerRequest,
  type Viewport,
} from '../../protocol/viewer.ts';
import type { ChromeService } from '../chrome/chrome-service.ts';
import type { ChromePage } from '../chrome/pages/page.ts';
import { navigate } from '../page-operations/actions.ts';
import { answerDialog } from '../page-operations/dialogs.ts';
import { pageTextMarkdown, readPageText } from '../page-operations/text.ts';
import type { Log } from '../platform/log.ts';
import { PageInput } from './page-input.ts';
import type { PageScreen, ScreenFrame, ScreenRegistry, ScreenViewer } from './page-screen.ts';

/** Above this many unsent bytes, a viewer is too slow and frames wait for it. */
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
/** The most page text a viewer may add to a message. */
const MAX_PAGE_TEXT_CHARS = 200_000;

export interface ViewerDependencies {
  readonly chrome: ChromeService;
  readonly screens: ScreenRegistry;
  readonly log: Log;
}

interface Attachment {
  readonly page: ChromePage;
  readonly screen: PageScreen;
  readonly input: PageInput;
  detach(): void;
}

/**
 * One viewer: a sidebar tab, connected over the viewer WebSocket. It watches one DSH
 * session's pages and shows one of them at a time.
 *
 * It shows what a Chrome window would: a page the shown page brings to the front (a popup,
 * a link's new tab) is shown next, and when a page opened that way is closed, the page that
 * opened it is shown again.
 *
 * A viewer holds at most one undelivered frame. The host sends a frame, the viewer
 * reports it drawn, and only then gets the next; frames produced in between replace
 * each other, so a slow viewer skips frames instead of falling behind.
 */
export class ViewerConnection implements ScreenViewer {
  readonly #socket: WebSocket;
  readonly #deps: ViewerDependencies;
  readonly #subscriptions: (() => void)[] = [];
  #sessionId: string | undefined;
  #viewport: Viewport = { width: 1, height: 1, deviceScaleFactor: 1 };
  #visible = true;
  #attachment: Attachment | undefined;
  /** While the viewer is visible and shows a page: the page's "shown" mark. */
  #releaseShown: (() => void) | undefined;
  /** Set once the socket closed; requests still running must not attach anything. */
  #closed = false;
  #frameSeq = 0;
  #frameInFlight: number | undefined;
  #waitingFrame: ScreenFrame | undefined;

  constructor(socket: WebSocket, deps: ViewerDependencies) {
    this.#socket = socket;
    this.#deps = deps;
    socket.on('message', (data, isBinary) => this.#receive(data, isBinary));
    socket.on('close', () => this.#close());
    socket.on('error', (error) =>
      deps.log.warn(`dsh-chrome: viewer connection failed: ${error.message}`),
    );
  }

  get viewport(): Viewport {
    return this.#viewport;
  }

  get visible(): boolean {
    return this.#visible;
  }

  showFrame(frame: ScreenFrame): void {
    if (
      !this.#visible ||
      this.#frameInFlight !== undefined ||
      this.#socket.bufferedAmount > MAX_BUFFERED_BYTES
    ) {
      this.#waitingFrame = frame;
      return;
    }
    const seq = ++this.#frameSeq;
    this.#frameInFlight = seq;
    this.#socket.send(encodeFrame({ seq, width: frame.width, height: frame.height }, frame.image));
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
    void this.#handle(request).catch((error: unknown) =>
      this.#send({
        type: 'failed',
        requestType: request.type,
        requestId: 'requestId' in request ? request.requestId : null,
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  async #handle(request: ViewerRequest): Promise<void> {
    const { chrome } = this.#deps;
    if (request.type === 'watch') {
      this.#watch(request.sessionId);
      return;
    }
    if (request.type === 'set-dedicated-display') {
      await chrome.setDedicatedDisplay(request.display);
      return;
    }
    const sessionId = this.#sessionId;
    if (sessionId === undefined) throw new Error('the viewer has not named its session');

    switch (request.type) {
      case 'open': {
        const url = requireAddress(request.url);
        this.#viewport = request.viewport;
        const page = await chrome.openPage(sessionId, url, { openedBy: 'user' });
        // The page stays open for the session; only this viewer is gone.
        if (!this.#closed) this.#attach(page);
        return;
      }
      case 'attach': {
        const page = chrome.page(request.pageId);
        if (page === undefined || page.sessionId !== sessionId) {
          this.#send({ type: 'ended', reason: 'the page is no longer open' });
          return;
        }
        this.#viewport = request.viewport;
        this.#attach(page);
        return;
      }
      case 'visibility':
        this.#visible = request.visible;
        this.#updateShown();
        this.#attachment?.screen.visibilityChanged();
        if (request.visible) this.#flushWaitingFrame();
        return;
      case 'frame-drawn':
        if (request.seq !== this.#frameInFlight) return;
        this.#frameInFlight = undefined;
        this.#flushWaitingFrame();
        return;
      default:
        break;
    }

    const attachment = this.#attachment;
    if (attachment === undefined) throw new Error('no page is shown');
    const { page, screen } = attachment;
    switch (request.type) {
      case 'resize':
        this.#viewport = request.viewport;
        screen.viewportChanged(this);
        return;
      case 'input':
        screen.claimOwnership(this);
        chrome.pages.touch(page.id);
        attachment.input.dispatch(request.input);
        screen.inputDispatched();
        return;
      case 'navigate':
        await navigate(page, { url: requireAddress(request.url) });
        return;
      case 'history':
        await navigate(page, { history: request.delta < 0 ? 'back' : 'forward' });
        return;
      case 'reload':
        await navigate(page, { history: 'reload' });
        return;
      case 'close-page':
        await page.close();
        return;
      case 'answer-help':
        chrome.helpRequests.answer(page.id, request.requestId, request.answer);
        return;
      case 'answer-dialog':
        await answerDialog(page, {
          accept: request.accept,
          promptText: request.promptText ?? undefined,
        });
        return;
      case 'read-text': {
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
    if (this.#sessionId !== undefined) {
      if (this.#sessionId !== sessionId) throw new Error('a viewer watches one session');
      return;
    }
    const { chrome } = this.#deps;
    this.#sessionId = sessionId;
    this.#subscriptions.push(
      chrome.pages.onChange(() => this.#sendPages()),
      chrome.pages.onPageOpened(({ page, opener, foreground }) => {
        if (foreground && opener.id === this.#attachment?.page.id) this.#attach(page);
      }),
      chrome.helpRequests.onChange((pageId) => {
        if (pageId === this.#attachment?.page.id) this.#sendHelp();
      }),
      chrome.onDedicatedChange((state) => this.#send({ type: 'dedicated-chrome', chrome: state })),
    );
    this.#sendPages();
    this.#send({ type: 'dedicated-chrome', chrome: chrome.dedicated });
  }

  #attach(page: ChromePage): void {
    this.#detach();
    const { screens, log } = this.#deps;
    const screen = screens.screenOf(page);
    const subscriptions = [
      page.onChanged(() => this.#send({ type: 'page', page: this.#stateOf(page) })),
      page.onEnded((ending) => {
        const opener =
          page.openerId === undefined ? undefined : this.#deps.chrome.page(page.openerId);
        if (ending === 'closed' && opener !== undefined) {
          this.#attach(opener);
          return;
        }
        this.#detach();
        this.#send({ type: 'ended', reason: ending });
      }),
    ];
    this.#attachment = {
      page,
      screen,
      input: new PageInput(page, log),
      detach: () => {
        for (const unsubscribe of subscriptions) unsubscribe();
        screen.removeViewer(this);
        screens.release(screen);
      },
    };
    this.#send({ type: 'attached', page: this.#stateOf(page) });
    this.#sendHelp();
    this.#updateShown();
    screen.addViewer(this);
  }

  #detach(): void {
    const attachment = this.#attachment;
    this.#attachment = undefined;
    attachment?.detach();
    this.#updateShown();
    this.#frameInFlight = undefined;
    this.#waitingFrame = undefined;
  }

  #close(): void {
    this.#closed = true;
    this.#detach();
    for (const unsubscribe of this.#subscriptions) unsubscribe();
    this.#subscriptions.length = 0;
  }

  /** Marks the shown page as seen by the user while this viewer is visible. */
  #updateShown(): void {
    const page = this.#attachment?.page;
    if (page === undefined || !this.#visible) {
      this.#releaseShown?.();
      this.#releaseShown = undefined;
    } else if (this.#releaseShown === undefined) {
      this.#releaseShown = this.#deps.chrome.pages.show(page.id);
    }
  }

  #flushWaitingFrame(): void {
    const frame = this.#waitingFrame;
    if (frame === undefined) return;
    this.#waitingFrame = undefined;
    this.showFrame(frame);
  }

  #sendPages(): void {
    const sessionId = this.#sessionId;
    if (sessionId === undefined) return;
    const pages = this.#deps.chrome.pagesOf(sessionId).map((page) => this.#stateOf(page));
    this.#send({ type: 'pages', pages });
  }

  #sendHelp(): void {
    const page = this.#attachment?.page;
    const request =
      page === undefined ? undefined : this.#deps.chrome.helpRequests.current(page.id);
    this.#send({
      type: 'help',
      request: request === undefined ? null : { id: request.id, message: request.message },
    });
  }

  #stateOf(page: ChromePage): PageState {
    return {
      id: page.id,
      url: page.url,
      title: page.title,
      loading: page.loading,
      browserLabel: page.browser.identity.label,
      openedBy: page.openedBy ?? null,
      openerId: page.openerId ?? null,
      dialog:
        page.dialog === undefined
          ? null
          : {
              kind: page.dialog.kind,
              message: page.dialog.message,
              defaultPrompt: page.dialog.defaultPrompt,
            },
    };
  }

  #send(event: ViewerEvent): void {
    if (this.#socket.readyState === this.#socket.OPEN) this.#socket.send(JSON.stringify(event));
  }
}

function requireAddress(input: string): string {
  const url = normalizeAddress(input);
  if (url === undefined) throw new Error(`"${input}" is not a web address`);
  return url;
}

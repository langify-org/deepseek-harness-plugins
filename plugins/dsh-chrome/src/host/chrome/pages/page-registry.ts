import { createHash } from 'node:crypto';
import type { PageSnapshot, TabId } from '../../../protocol/connector.ts';
import type { PageOpener } from '../../../protocol/viewer.ts';
import type {
  CdpArgs,
  CdpCommand,
  CdpEventName,
  CdpEventParams,
  CdpResult,
} from '../connector/cdp.ts';
import type { ConnectedBrowser, RequestOptions } from '../connector/connected-browser.ts';
import type { ChromePage, PageDialog, PageEnding, PageId, PageOrigin } from './page.ts';

/** A page of a session opened another: a popup, or a link's new tab. */
export interface PageOpening {
  readonly page: ChromePage;
  readonly opener: ChromePage;
  /** Whether Chrome put the new page in front of its opener, as it does a popup. */
  readonly foreground: boolean;
}

class Page implements ChromePage {
  readonly id: PageId;
  readonly sessionId: string;
  readonly browser: ConnectedBrowser;
  readonly tabId: TabId;
  readonly openedBy: PageOpener | undefined;
  readonly openerId: PageId | undefined;
  #snapshot: PageSnapshot;
  #dialog: PageDialog | undefined;
  #ending: PageEnding | undefined;
  readonly #eventListeners = new Map<string, Set<(params: unknown) => void>>();
  readonly #changeListeners = new Set<(page: ChromePage) => void>();
  readonly #endListeners = new Set<(ending: PageEnding) => void>();

  constructor(
    id: PageId,
    sessionId: string,
    browser: ConnectedBrowser,
    snapshot: PageSnapshot,
    origin: PageOrigin,
  ) {
    this.id = id;
    this.sessionId = sessionId;
    this.browser = browser;
    this.tabId = snapshot.tabId;
    this.openedBy = origin.openedBy;
    this.openerId = origin.openerId;
    this.#snapshot = snapshot;
  }

  get dialog(): PageDialog | undefined {
    return this.#dialog;
  }

  get url(): string {
    return this.#snapshot.url;
  }

  get title(): string {
    return this.#snapshot.title;
  }

  get loading(): boolean {
    return this.#snapshot.loading;
  }

  get ending(): PageEnding | undefined {
    return this.#ending;
  }

  async send<M extends CdpCommand>(
    method: M,
    ...[params, options]: CdpArgs<M, RequestOptions>
  ): Promise<CdpResult<M>> {
    const result = await this.browser.sendCdp(this.tabId, method, params ?? {}, options);
    // Chrome defines the result shape (see cdp.ts); the plugin does not re-validate it.
    return result as CdpResult<M>;
  }

  on<E extends CdpEventName>(
    event: E,
    listener: (...params: CdpEventParams<E>) => void,
  ): () => void {
    const wrapped = (params: unknown) => (listener as (params: unknown) => void)(params);
    let listeners = this.#eventListeners.get(event);
    if (listeners === undefined) {
      listeners = new Set();
      this.#eventListeners.set(event, listeners);
    }
    listeners.add(wrapped);
    return () => listeners.delete(wrapped);
  }

  onChanged(listener: (page: ChromePage) => void): () => void {
    this.#changeListeners.add(listener);
    return () => this.#changeListeners.delete(listener);
  }

  onEnded(listener: (ending: PageEnding) => void): () => void {
    if (this.#ending !== undefined) {
      listener(this.#ending);
      return () => {};
    }
    this.#endListeners.add(listener);
    return () => this.#endListeners.delete(listener);
  }

  activate(): Promise<void> {
    return this.browser.activatePage(this.tabId);
  }

  async bringToFront(): Promise<void> {
    if (this.browser.visibleWindows || this.browser.isInFront(this.tabId)) return;
    await this.browser.activatePage(this.tabId);
  }

  close(): Promise<void> {
    return this.browser.closePage(this.tabId);
  }

  dispatchEvent(method: string, params: unknown): void {
    for (const listener of this.#eventListeners.get(method) ?? []) listener(params);
  }

  update(snapshot: PageSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#changeListeners) listener(this);
  }

  updateDialog(dialog: PageDialog | undefined): void {
    this.#dialog = dialog;
    for (const listener of this.#changeListeners) listener(this);
  }

  end(ending: PageEnding): void {
    if (this.#ending !== undefined) return;
    this.#ending = ending;
    for (const listener of this.#endListeners) listener(ending);
    this.#endListeners.clear();
    this.#changeListeners.clear();
    this.#eventListeners.clear();
  }
}

/**
 * All pages the plugin controls, across connected browsers, with their owning sessions.
 * It routes each browser's events to the page they concern, and remembers which pages
 * were used last and which the user is looking at.
 *
 * It follows each page's JavaScript dialogs, which block the page until someone answers:
 * Chrome reports them once the page's `Page` domain is on, which adopting a page turns on.
 */
export class PageRegistry {
  readonly #pages = new Map<PageId, Page>();
  readonly #byTab = new Map<ConnectedBrowser, Map<TabId, Page>>();
  readonly #listeners = new Set<() => void>();
  readonly #openingListeners = new Set<(opening: PageOpening) => void>();
  /** The order of last use: a larger number is more recent. */
  readonly #lastUse = new Map<PageId, number>();
  /** How many visible viewers show each page. */
  readonly #shownBy = new Map<PageId, number>();
  #useCount = 0;

  /** Starts routing a browser's events; its pages end when it disconnects. */
  track(browser: ConnectedBrowser): void {
    const tabs = new Map<TabId, Page>();
    this.#byTab.set(browser, tabs);
    browser.onEvent((event) => {
      switch (event.type) {
        case 'cdp-event': {
          const page = tabs.get(event.tabId);
          if (page === undefined) return;
          if (event.method === 'Page.javascriptDialogOpening') {
            page.updateDialog(dialogOf(event.params));
            this.#notify();
          } else if (event.method === 'Page.javascriptDialogClosed') {
            page.updateDialog(undefined);
            this.#notify();
          }
          page.dispatchEvent(event.method, event.params);
          return;
        }
        case 'page-changed': {
          const page = tabs.get(event.page.tabId);
          if (page === undefined) return;
          page.update(event.page);
          this.#notify();
          return;
        }
        case 'page-ended': {
          const page = tabs.get(event.tabId);
          if (page !== undefined) this.#remove(page, event.reason);
          return;
        }
        case 'page-opened': {
          // The opened page belongs to the opener's session, as the connector's group says.
          const opener = tabs.get(event.openerTabId);
          const page = this.adopt(opener?.sessionId ?? event.page.groupKey, browser, event.page, {
            openedBy: 'page',
            ...(opener === undefined ? {} : { openerId: opener.id }),
          });
          if (opener === undefined) return;
          const opening = { page, opener, foreground: event.foreground };
          for (const listener of [...this.#openingListeners]) listener(opening);
          return;
        }
      }
    });
    browser.onClose(() => {
      for (const page of [...tabs.values()]) this.#remove(page, 'disconnected');
      this.#byTab.delete(browser);
    });
  }

  /** Registers a page the browser reports, as owned by the session, and as its latest. */
  adopt(
    sessionId: string,
    browser: ConnectedBrowser,
    snapshot: PageSnapshot,
    origin: PageOrigin = {},
  ): ChromePage {
    const tabs = this.#byTab.get(browser);
    if (tabs === undefined) throw new Error('adopting a page of an untracked browser');
    const existing = tabs.get(snapshot.tabId);
    if (existing !== undefined) return existing;
    const page = new Page(
      this.#idFor(browser, snapshot.tabId),
      sessionId,
      browser,
      snapshot,
      origin,
    );
    tabs.set(page.tabId, page);
    this.#pages.set(page.id, page);
    this.#lastUse.set(page.id, ++this.#useCount);
    // A page that cannot take it is one whose tab is closing; its ending follows.
    void page.send('Page.enable').catch(() => {});
    this.#notify();
    return page;
  }

  /** Listens to pages of a session opening other pages. */
  onPageOpened(listener: (opening: PageOpening) => void): () => void {
    this.#openingListeners.add(listener);
    return () => this.#openingListeners.delete(listener);
  }

  /** Ends every page of the browser, for a reason of the host's, before the browser leaves. */
  endPagesOf(browser: ConnectedBrowser, ending: PageEnding): void {
    for (const page of [...(this.#byTab.get(browser)?.values() ?? [])]) this.#remove(page, ending);
  }

  get(id: PageId): ChromePage | undefined {
    return this.#pages.get(id);
  }

  /** The session's pages, most recently used first. */
  ofSession(sessionId: string): ChromePage[] {
    return [...this.#pages.values()]
      .filter((page) => page.sessionId === sessionId)
      .sort((a, b) => (this.#lastUse.get(b.id) ?? 0) - (this.#lastUse.get(a.id) ?? 0));
  }

  /** Records that the user or the agent worked with the page. */
  touch(id: PageId): void {
    if (!this.#pages.has(id) || this.#lastUse.get(id) === this.#useCount) return;
    this.#lastUse.set(id, ++this.#useCount);
    this.#notify();
  }

  /** Records that a visible viewer shows the page, until the returned release is called. */
  show(id: PageId): () => void {
    this.#shownBy.set(id, (this.#shownBy.get(id) ?? 0) + 1);
    this.touch(id);
    this.#notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.#shownBy.get(id) ?? 1) - 1;
      if (count > 0) this.#shownBy.set(id, count);
      else this.#shownBy.delete(id);
      this.#notify();
    };
  }

  /** Whether some visible viewer shows the page. */
  isShown(id: PageId): boolean {
    return (this.#shownBy.get(id) ?? 0) > 0;
  }

  /**
   * Listens to pages being added, removed, used or shown, and to changes of their address,
   * title or dialog.
   */
  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The tab's page id; in the rare case another page holds it, the next free derivation. */
  #idFor(browser: ConnectedBrowser, tabId: TabId): PageId {
    for (let attempt = 0; ; attempt++) {
      const digest = createHash('sha256')
        .update(`${browser.identity.browserId}\0${tabId}\0${attempt}`)
        .digest('hex');
      const id = `p${digest.slice(0, 6)}`;
      if (!this.#pages.has(id)) return id;
    }
  }

  #remove(page: Page, ending: PageEnding): void {
    this.#pages.delete(page.id);
    this.#lastUse.delete(page.id);
    this.#byTab.get(page.browser)?.delete(page.tabId);
    page.end(ending);
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

/** The dialog a `Page.javascriptDialogOpening` event announces. */
function dialogOf(params: unknown): PageDialog {
  const { type, message, defaultPrompt, url } = (params ?? {}) as {
    type?: unknown;
    message?: unknown;
    defaultPrompt?: unknown;
    url?: unknown;
  };
  return {
    kind:
      type === 'alert' || type === 'confirm' || type === 'prompt' || type === 'beforeunload'
        ? type
        : 'alert',
    message: typeof message === 'string' ? message : '',
    defaultPrompt: typeof defaultPrompt === 'string' ? defaultPrompt : '',
    url: typeof url === 'string' ? url : '',
  };
}

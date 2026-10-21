import { createHash } from 'node:crypto';
import type { PageEndReason, PageSnapshot, TabId } from '../../protocol/connector.ts';
import type { PageOpener } from '../../protocol/viewer.ts';
import type { CdpArgs, CdpCommand, CdpEventName, CdpEventParams, CdpResult } from './cdp.ts';
import type { ConnectedBrowser, RequestOptions } from './connected-browser.ts';

/**
 * A page's id: short, because the agent reads and writes it, and unique among the pages of
 * this host. It is derived from the browser and the tab, so a page keeps its id when DSH
 * restarts and adopts it again, and earlier tool results still name it.
 */
export type PageId = string;

/** Why a page is no longer controlled: the connector's reasons, or its browser left. */
export type PageEnding = PageEndReason | 'disconnected';

/** A Chrome tab the plugin opened, owned by one DSH session. */
export interface ChromePage {
  readonly id: PageId;
  readonly sessionId: string;
  readonly browser: ConnectedBrowser;
  readonly tabId: TabId;
  /** `undefined` for a page adopted from a connector that outlived the host. */
  readonly openedBy: PageOpener | undefined;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** Set once the page can no longer be controlled. */
  readonly ending: PageEnding | undefined;

  /** Sends one CDP command to the page. */
  send<M extends CdpCommand>(method: M, ...args: CdpArgs<M, RequestOptions>): Promise<CdpResult<M>>;
  /** Listens to one CDP event of the page; returns the unsubscribe function. */
  on<E extends CdpEventName>(
    event: E,
    listener: (...params: CdpEventParams<E>) => void,
  ): () => void;
  /** Listens to URL, title and loading changes. */
  onChanged(listener: (page: ChromePage) => void): () => void;
  /** Runs once the page ends; immediately if it already has. */
  onEnded(listener: (ending: PageEnding) => void): () => void;
  /** Makes the page its window's active tab, so Chrome renders it. */
  activate(): Promise<void>;
  /** Closes the tab. */
  close(): Promise<void>;
}

/**
 * The page as one operation sees it: every command it sends ends when the signal aborts,
 * as a tool call's commands end when the call is stopped. Everything else is the page's.
 */
export function boundToSignal(page: ChromePage, signal: AbortSignal): ChromePage {
  return new SignalBoundPage(page, signal);
}

class SignalBoundPage implements ChromePage {
  readonly #page: ChromePage;
  readonly #signal: AbortSignal;

  constructor(page: ChromePage, signal: AbortSignal) {
    this.#page = page;
    this.#signal = signal;
  }

  get id(): PageId {
    return this.#page.id;
  }

  get sessionId(): string {
    return this.#page.sessionId;
  }

  get browser(): ConnectedBrowser {
    return this.#page.browser;
  }

  get tabId(): TabId {
    return this.#page.tabId;
  }

  get openedBy(): PageOpener | undefined {
    return this.#page.openedBy;
  }

  get url(): string {
    return this.#page.url;
  }

  get title(): string {
    return this.#page.title;
  }

  get loading(): boolean {
    return this.#page.loading;
  }

  get ending(): PageEnding | undefined {
    return this.#page.ending;
  }

  send<M extends CdpCommand>(
    method: M,
    ...[params, options]: CdpArgs<M, RequestOptions>
  ): Promise<CdpResult<M>> {
    const signal =
      options?.signal === undefined
        ? this.#signal
        : AbortSignal.any([options.signal, this.#signal]);
    // The same arguments with the signal added; TypeScript cannot follow the tuple through.
    const args = [params, { ...options, signal }] as unknown as CdpArgs<M, RequestOptions>;
    return this.#page.send(method, ...args);
  }

  on<E extends CdpEventName>(
    event: E,
    listener: (...params: CdpEventParams<E>) => void,
  ): () => void {
    return this.#page.on(event, listener);
  }

  onChanged(listener: (page: ChromePage) => void): () => void {
    return this.#page.onChanged(listener);
  }

  onEnded(listener: (ending: PageEnding) => void): () => void {
    return this.#page.onEnded(listener);
  }

  activate(): Promise<void> {
    return this.#page.activate();
  }

  close(): Promise<void> {
    return this.#page.close();
  }
}

class Page implements ChromePage {
  readonly id: PageId;
  readonly sessionId: string;
  readonly browser: ConnectedBrowser;
  readonly tabId: TabId;
  readonly openedBy: PageOpener | undefined;
  #snapshot: PageSnapshot;
  #ending: PageEnding | undefined;
  readonly #eventListeners = new Map<string, Set<(params: unknown) => void>>();
  readonly #changeListeners = new Set<(page: ChromePage) => void>();
  readonly #endListeners = new Set<(ending: PageEnding) => void>();

  constructor(
    id: PageId,
    sessionId: string,
    browser: ConnectedBrowser,
    snapshot: PageSnapshot,
    openedBy: PageOpener | undefined,
  ) {
    this.id = id;
    this.sessionId = sessionId;
    this.browser = browser;
    this.tabId = snapshot.tabId;
    this.openedBy = openedBy;
    this.#snapshot = snapshot;
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
 */
export class PageRegistry {
  readonly #pages = new Map<PageId, Page>();
  readonly #byTab = new Map<ConnectedBrowser, Map<TabId, Page>>();
  readonly #listeners = new Set<() => void>();
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
        case 'cdp-event':
          tabs.get(event.tabId)?.dispatchEvent(event.method, event.params);
          return;
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
    openedBy?: PageOpener,
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
      openedBy,
    );
    tabs.set(page.tabId, page);
    this.#pages.set(page.id, page);
    this.#lastUse.set(page.id, ++this.#useCount);
    this.#notify();
    return page;
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

  /** Listens to pages being added, removed, used, shown, or changing address or title. */
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

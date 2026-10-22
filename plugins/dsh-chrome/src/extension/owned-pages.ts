import type { PageEndReason, PageGroup, PageSnapshot, TabId } from '../protocol/connector.ts';

/** The CDP version `chrome.debugger` speaks. */
const CDP_VERSION = '1.3';
/** How often, and how many times, a window asked to take the focus is checked for it. */
const FOCUS_CHECK_MS = 25;
const FOCUS_CHECKS = 40;
const STATE_KEY = 'ownedPages';

/**
 * What the connector remembers across service worker restarts. Chrome keeps
 * `storage.session` until the browser exits, which is also when tab ids expire.
 */
interface OwnedPagesState {
  /** The tabs this connector controls, by tab id, with the group each belongs to. */
  pages: Record<string, { groupKey: string }>;
  /** The window new pages open in, while it exists. */
  agentWindowId: number | null;
  /** Chrome's tab group id for each group key. */
  groupIds: Record<string, number>;
}

export interface OwnedPagesListener {
  readonly onChanged: (page: PageSnapshot) => void;
  readonly onEnded: (tabId: TabId, reason: PageEndReason) => void;
  /** An owned page opened another tab, which the connector now owns too. */
  readonly onOpened: (page: PageSnapshot, openerTabId: TabId, foreground: boolean) => void;
}

/**
 * The tabs the connector opened and controls through `chrome.debugger`, and the tabs those
 * opened in turn (a sign-in popup, a link that opens a new tab), which belong to the same
 * DSH session.
 *
 * The connector touches no other tab: every request names a tab, and only owned tabs
 * are accepted. Pages open in one agent window per browser, grouped per DSH session.
 * Whenever a page stops being controlled — closed by the host, by the user, or released
 * from Chrome's debugging infobar — the listener hears about it exactly once.
 */
export class OwnedPages {
  readonly #listener: OwnedPagesListener;
  #state: OwnedPagesState = { pages: {}, agentWindowId: null, groupIds: {} };
  /** Whether Chrome's windows are on a screen someone sees, as the host says; until then, they are. */
  #visibleWindows = true;
  #queue: Promise<unknown> = Promise.resolve();

  /** Registers Chrome's tab and debugger listeners; construct while the service worker starts. */
  constructor(listener: OwnedPagesListener) {
    this.#listener = listener;
    chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
      const owned = this.#state.pages[String(tabId)];
      if (owned === undefined) return;
      if (change.url !== undefined || change.title !== undefined || change.status !== undefined) {
        listener.onChanged(snapshotOf(tab, owned.groupKey));
      }
    });
    chrome.tabs.onRemoved.addListener((tabId) => {
      void this.#end(tabId, 'closed');
    });
    chrome.tabs.onCreated.addListener((tab) => {
      const opener =
        tab.openerTabId === undefined ? undefined : this.#state.pages[String(tab.openerTabId)];
      if (opener !== undefined && tab.openerTabId !== undefined) {
        void this.#adoptOpened(tab, opener.groupKey, tab.openerTabId);
      }
    });
    chrome.debugger.onDetach.addListener((source, reason) => {
      if (source.tabId === undefined) return;
      void this.#end(source.tabId, reason === 'canceled_by_user' ? 'released-by-user' : 'closed');
    });
  }

  /**
   * Restores the state of an earlier service worker. Pages whose tab still exists are
   * attached again if Chrome detached them; pages whose tab is gone are forgotten.
   */
  restore(): Promise<void> {
    return this.#exclusive(async () => {
      const stored = await chrome.storage.session.get(STATE_KEY);
      const state = stored[STATE_KEY] as OwnedPagesState | undefined;
      if (state === undefined) return;
      this.#state = state;
      const attached = new Set(
        (await chrome.debugger.getTargets())
          .filter((target) => target.attached && target.tabId !== undefined)
          .map((target) => target.tabId),
      );
      for (const key of Object.keys(state.pages)) {
        const tabId = Number(key);
        if (attached.has(tabId)) continue;
        const reattached = await chrome.debugger.attach({ tabId }, CDP_VERSION).then(
          () => true,
          () => false,
        );
        if (!reattached) delete this.#state.pages[key];
      }
      await this.#save();
    });
  }

  owns(tabId: TabId): boolean {
    return String(tabId) in this.#state.pages;
  }

  /**
   * Sets how pages are arranged (see `WelcomeMessage.visibleWindows`): on a screen someone
   * sees, in the agent window, grouped per session; elsewhere, each in a window of its own.
   */
  setVisibleWindows(visible: boolean): void {
    this.#visibleWindows = visible;
  }

  open(url: string, group: PageGroup): Promise<PageSnapshot> {
    return this.#exclusive(async () => {
      const tab = this.#visibleWindows
        ? await this.#createTabInAgentWindow(url)
        : await this.#createWindow(url, true);
      const tabId = requireTabId(tab);
      try {
        if (this.#visibleWindows) await this.#assignGroup(tabId, tab.windowId, group);
        await chrome.debugger.attach({ tabId }, CDP_VERSION);
      } catch (error) {
        await chrome.tabs.remove(tabId).catch(() => {});
        throw error;
      }
      this.#state.pages[String(tabId)] = { groupKey: group.key };
      await this.#save();
      return snapshotOf(tab, group.key);
    });
  }

  /** Closes the page's tab. Its ending is reported like any other. */
  close(tabId: TabId): Promise<void> {
    return this.#exclusive(async () => {
      await chrome.debugger.detach({ tabId }).catch(() => {});
      const removed = await chrome.tabs.remove(tabId).then(
        () => true,
        () => false,
      );
      // A removed tab reports its ending through onRemoved; a tab that could not be
      // removed is no longer controlled either.
      if (!removed) await this.#end(tabId, 'closed');
    });
  }

  /**
   * Makes the page its window's active tab; where nobody sees the windows, focuses the window
   * too, and returns once Chrome has it focused: the system grants the focus after the request,
   * and until then Chrome would answer the page's dialogs itself.
   */
  async activate(tabId: TabId): Promise<void> {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (this.#visibleWindows || tab?.windowId === undefined) return;
    await chrome.windows.update(tab.windowId, { focused: true });
    await untilFocused(tab.windowId);
  }

  async list(): Promise<PageSnapshot[]> {
    const pages: PageSnapshot[] = [];
    for (const [key, { groupKey }] of Object.entries(this.#state.pages)) {
      const tab = await chrome.tabs.get(Number(key)).catch(() => undefined);
      if (tab !== undefined) pages.push(snapshotOf(tab, groupKey));
    }
    return pages;
  }

  /** Takes control of a tab an owned page opened, in the opener's group. */
  #adoptOpened(tab: chrome.tabs.Tab, groupKey: string, openerTabId: TabId): Promise<void> {
    return this.#exclusive(async () => {
      const tabId = tab.id;
      if (tabId === undefined || this.owns(tabId)) return;
      if (!this.#visibleWindows) {
        // Every page has a window of its own: a link's new tab would leave its opener behind.
        const sharing = await chrome.tabs.query({ windowId: tab.windowId });
        if (sharing.length > 1) {
          await chrome.windows.create({ tabId, focused: tab.active }).catch(() => undefined);
        }
      }
      const attached = await chrome.debugger.attach({ tabId }, CDP_VERSION).then(
        () => true,
        () => false,
      );
      // A tab that closed at once, or one Chrome does not let extensions debug, stays as it is.
      if (!attached) return;
      this.#state.pages[String(tabId)] = { groupKey };
      await this.#save();
      const current = await chrome.tabs.get(tabId).catch(() => tab);
      // Whether it came to the front is how Chrome opened it, not how it is now.
      this.#listener.onOpened(snapshotOf(current, groupKey), openerTabId, tab.active);
    });
  }

  /** Forgets the page and reports its ending, once. */
  async #end(tabId: TabId, reason: PageEndReason): Promise<void> {
    const key = String(tabId);
    if (!(key in this.#state.pages)) return;
    delete this.#state.pages[key];
    this.#listener.onEnded(tabId, reason);
    await this.#save();
  }

  /** A new tab in the agent window, which is created, out of focus, when there is none. */
  async #createTabInAgentWindow(url: string): Promise<chrome.tabs.Tab> {
    const windowId = this.#state.agentWindowId;
    const window =
      windowId === null ? undefined : await chrome.windows.get(windowId).catch(() => undefined);
    if (window?.id !== undefined) {
      return chrome.tabs.create({ windowId: window.id, url, active: true });
    }
    const tab = await this.#createWindow(url, false);
    this.#state.agentWindowId = tab.windowId;
    this.#state.groupIds = {};
    return tab;
  }

  async #createWindow(url: string, focused: boolean): Promise<chrome.tabs.Tab> {
    const created = await chrome.windows.create({ url, focused });
    const tab = created?.tabs?.[0];
    if (created?.id === undefined || tab === undefined) {
      throw new Error('Chrome did not create a window for the page');
    }
    return tab;
  }

  async #assignGroup(tabId: TabId, windowId: number, group: PageGroup): Promise<void> {
    const known = this.#state.groupIds[group.key];
    const existing =
      known === undefined ? undefined : await chrome.tabGroups.get(known).catch(() => undefined);
    if (existing !== undefined && existing.windowId === windowId) {
      await chrome.tabs.group({ groupId: existing.id, tabIds: [tabId] });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: group.title, color: 'blue' });
    this.#state.groupIds[group.key] = groupId;
  }

  async #save(): Promise<void> {
    await chrome.storage.session.set({ [STATE_KEY]: this.#state });
  }

  /** Runs state changes one at a time: two concurrent opens must share one agent window. */
  #exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => {});
    return run;
  }
}

/** Waits, for a while at most, until Chrome reports the window focused or gone. */
async function untilFocused(windowId: number): Promise<void> {
  for (let check = 0; check < FOCUS_CHECKS; check += 1) {
    const window = await chrome.windows.get(windowId).catch(() => undefined);
    if (window === undefined || window.focused) return;
    await new Promise((resolve) => setTimeout(resolve, FOCUS_CHECK_MS));
  }
}

function requireTabId(tab: chrome.tabs.Tab): TabId {
  if (tab.id === undefined) throw new Error('Chrome created a tab without an id');
  return tab.id;
}

function snapshotOf(tab: chrome.tabs.Tab, groupKey: string): PageSnapshot {
  return {
    tabId: requireTabId(tab),
    groupKey,
    url: tab.url ?? tab.pendingUrl ?? '',
    title: tab.title ?? '',
    loading: tab.status === 'loading',
  };
}

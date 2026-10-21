import type { PageEndReason, PageGroup, PageSnapshot, TabId } from '../protocol/connector.ts';

/** The CDP version `chrome.debugger` speaks. */
const CDP_VERSION = '1.3';
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
}

/**
 * The tabs the connector opened and controls through `chrome.debugger`.
 *
 * The connector touches no other tab: every request names a tab, and only owned tabs
 * are accepted. Pages open in one agent window per browser, grouped per DSH session.
 * Whenever a page stops being controlled — closed by the host, by the user, or released
 * from Chrome's debugging infobar — the listener hears about it exactly once.
 */
export class OwnedPages {
  readonly #listener: OwnedPagesListener;
  #state: OwnedPagesState = { pages: {}, agentWindowId: null, groupIds: {} };
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

  open(url: string, group: PageGroup): Promise<PageSnapshot> {
    return this.#exclusive(async () => {
      const tab = await this.#createTab(url);
      const tabId = requireTabId(tab);
      try {
        await this.#assignGroup(tabId, tab.windowId, group);
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

  async activate(tabId: TabId): Promise<void> {
    await chrome.tabs.update(tabId, { active: true });
  }

  async list(): Promise<PageSnapshot[]> {
    const pages: PageSnapshot[] = [];
    for (const [key, { groupKey }] of Object.entries(this.#state.pages)) {
      const tab = await chrome.tabs.get(Number(key)).catch(() => undefined);
      if (tab !== undefined) pages.push(snapshotOf(tab, groupKey));
    }
    return pages;
  }

  /** Forgets the page and reports its ending, once. */
  async #end(tabId: TabId, reason: PageEndReason): Promise<void> {
    const key = String(tabId);
    if (!(key in this.#state.pages)) return;
    delete this.#state.pages[key];
    this.#listener.onEnded(tabId, reason);
    await this.#save();
  }

  async #createTab(url: string): Promise<chrome.tabs.Tab> {
    const windowId = this.#state.agentWindowId;
    const window =
      windowId === null ? undefined : await chrome.windows.get(windowId).catch(() => undefined);
    if (window?.id !== undefined) {
      return chrome.tabs.create({ windowId: window.id, url, active: true });
    }
    const created = await chrome.windows.create({ url, focused: false });
    const tab = created?.tabs?.[0];
    if (created?.id === undefined || tab === undefined) {
      throw new Error('Chrome did not create the agent window');
    }
    this.#state.agentWindowId = created.id;
    this.#state.groupIds = {};
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

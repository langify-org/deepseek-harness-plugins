import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  BrowserEvent,
  ConnectedBrowser,
  RequestOptions,
} from '../../../../../src/host/chrome/connector/connected-browser.ts';
import type { ChromePage, PageEnding } from '../../../../../src/host/chrome/pages/page.ts';
import { PageRegistry } from '../../../../../src/host/chrome/pages/page-registry.ts';
import type { PageSnapshot } from '../../../../../src/protocol/connector.ts';

interface FakeBrowser {
  readonly identity: {
    readonly profile: string;
    readonly browserId: string;
    readonly label: string;
    readonly extensionVersion: string;
  };
  eventListener: ((event: BrowserEvent) => void) | undefined;
  closeListener: (() => void) | undefined;
  readonly cdpCalls: { readonly tabId: number; readonly method: string }[];
  onEvent(listener: (event: BrowserEvent) => void): () => void;
  onClose(listener: () => void): () => void;
  sendCdp(
    tabId: number,
    method: string,
    params: object,
    options?: RequestOptions,
  ): Promise<unknown>;
  activatePage(tabId: number, options?: RequestOptions): Promise<void>;
  closePage(tabId: number, options?: RequestOptions): Promise<void>;
  emit(event: BrowserEvent): void;
  close(): void;
}

function fakeBrowser(label = 'Work Chrome'): FakeBrowser {
  const browser: FakeBrowser = {
    identity: {
      profile: 'personal',
      browserId: `browser-${label}`,
      label,
      extensionVersion: '1.0.0',
    },
    eventListener: undefined,
    closeListener: undefined,
    cdpCalls: [],
    onEvent(listener) {
      browser.eventListener = listener;
      return () => {
        browser.eventListener = undefined;
      };
    },
    onClose(listener) {
      browser.closeListener = listener;
      return () => {
        browser.closeListener = undefined;
      };
    },
    sendCdp(tabId, method) {
      browser.cdpCalls.push({ tabId, method });
      return Promise.resolve({});
    },
    activatePage() {
      return Promise.resolve();
    },
    closePage() {
      return Promise.resolve();
    },
    emit(event) {
      browser.eventListener?.(event);
    },
    close() {
      browser.closeListener?.();
    },
  };
  return browser;
}

function snapshot(
  tabId: number,
  overrides: Partial<Omit<PageSnapshot, 'tabId'>> = {},
): PageSnapshot {
  return {
    tabId,
    groupKey: 'session-1',
    url: `https://example.com/${tabId}`,
    title: `Page ${tabId}`,
    loading: false,
    ...overrides,
  };
}

test('gives a tab the same page id in a new registry, as after a restart of DSH', () => {
  const browser = fakeBrowser() as unknown as ConnectedBrowser;
  const before = new PageRegistry();
  before.track(browser);
  const after = new PageRegistry();
  after.track(browser);

  const page = before.adopt('session-1', browser, snapshot(4));
  assert.equal(after.adopt('session-1', browser, snapshot(4)).id, page.id);
  assert.notEqual(after.adopt('session-1', browser, snapshot(5)).id, page.id);

  const other = fakeBrowser('Home Chrome') as unknown as ConnectedBrowser;
  after.track(other);
  assert.notEqual(after.adopt('session-1', other, snapshot(4)).id, page.id);
});

test('adopts a page with a minted short id, the session, and the tab snapshot', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);

  const page = registry.adopt(
    'session-1',
    connection,
    snapshot(4, { url: 'https://example.com/a', title: 'A', loading: true }),
  );

  assert.match(page.id, /^p[0-9a-f]{6}$/);
  assert.equal(page.sessionId, 'session-1');
  assert.equal(page.tabId, 4);
  assert.equal(page.url, 'https://example.com/a');
  assert.equal(page.title, 'A');
  assert.equal(page.loading, true);
  assert.equal(registry.get(page.id), page);
});

test('returns the same page when the same tab is adopted twice', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);

  const first = registry.adopt('session-1', connection, snapshot(4));
  const second = registry.adopt(
    'session-1',
    connection,
    snapshot(4, { url: 'https://example.com/changed', title: 'Changed' }),
  );

  assert.equal(second, first);
  assert.equal(first.url, 'https://example.com/4');
  assert.equal(first.title, 'Page 4');
  assert.equal(registry.ofSession('session-1').length, 1);
});

test("lists a session's pages most recently used first and touch() moves one to the front", () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);

  const first = registry.adopt('session-1', connection, snapshot(1));
  const second = registry.adopt('session-1', connection, snapshot(2));
  const other = registry.adopt('session-2', connection, snapshot(3));

  assert.deepEqual(
    registry.ofSession('session-1').map((page) => page.id),
    [second.id, first.id],
  );
  assert.deepEqual(
    registry.ofSession('session-2').map((page) => page.id),
    [other.id],
  );
  assert.deepEqual(registry.ofSession('session-3'), []);

  registry.touch(first.id);
  assert.deepEqual(
    registry.ofSession('session-1').map((page) => page.id),
    [first.id, second.id],
  );
});

test('marks a page shown until every release is called, and release is idempotent', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);
  const page = registry.adopt('session-1', connection, snapshot(4));

  assert.equal(registry.isShown(page.id), false);
  const releaseFirst = registry.show(page.id);
  const releaseSecond = registry.show(page.id);
  assert.equal(registry.isShown(page.id), true);

  releaseFirst();
  assert.equal(registry.isShown(page.id), true);
  releaseSecond();
  assert.equal(registry.isShown(page.id), false);

  releaseSecond();
  releaseFirst();
  assert.equal(registry.isShown(page.id), false);
});

test('notifies change listeners when a page is adopted, shown, released, changed, or removed', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);

  let changes = 0;
  registry.onChange(() => {
    changes += 1;
  });

  const page = registry.adopt('session-1', connection, snapshot(4));
  assert.equal(changes, 1);

  const release = registry.show(page.id);
  assert.equal(changes, 2);

  release();
  assert.equal(changes, 3);
  release();
  assert.equal(changes, 3);

  browser.emit({ type: 'page-changed', page: snapshot(4, { title: 'New title' }) });
  assert.equal(changes, 4);

  browser.emit({ type: 'page-ended', tabId: 4, reason: 'closed' });
  assert.equal(changes, 5);
});

test('notifies change listeners on touch only when the order changes', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);

  const first = registry.adopt('session-1', connection, snapshot(1));
  const second = registry.adopt('session-1', connection, snapshot(2));
  let changes = 0;
  registry.onChange(() => {
    changes += 1;
  });

  registry.touch(second.id);
  assert.equal(changes, 0);

  registry.touch(first.id);
  assert.equal(changes, 1);

  registry.touch(first.id);
  assert.equal(changes, 1);
});

test('a page-changed event updates the page and tells its change listeners', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);
  const page = registry.adopt(
    'session-1',
    connection,
    snapshot(4, { url: 'https://example.com/a', title: 'A', loading: false }),
  );

  const changed: ChromePage[] = [];
  page.onChanged((changedPage) => changed.push(changedPage));
  let changes = 0;
  registry.onChange(() => {
    changes += 1;
  });

  browser.emit({
    type: 'page-changed',
    page: snapshot(4, { url: 'https://example.com/b', title: 'B', loading: true }),
  });

  assert.equal(page.url, 'https://example.com/b');
  assert.equal(page.title, 'B');
  assert.equal(page.loading, true);
  assert.deepEqual(changed, [page]);
  assert.equal(changed[0], page);
  assert.equal(changes, 1);
});

test('routes a cdp-event to the page listeners of that method', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);
  const page = registry.adopt('session-1', connection, snapshot(4));

  const received: unknown[] = [];
  page.on('Page.loadEventFired', (params) => received.push(params));

  browser.emit({
    type: 'cdp-event',
    tabId: 4,
    method: 'Page.loadEventFired',
    params: { timestamp: 12.5 },
  });

  assert.deepEqual(received, [{ timestamp: 12.5 }]);
});

test('a page-ended event removes the page and ends it with the reason', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);
  const page = registry.adopt('session-1', connection, snapshot(4));

  const endings: PageEnding[] = [];
  page.onEnded((ending) => endings.push(ending));
  let changes = 0;
  registry.onChange(() => {
    changes += 1;
  });

  browser.emit({ type: 'page-ended', tabId: 4, reason: 'released-by-user' });

  assert.deepEqual(endings, ['released-by-user']);
  assert.equal(registry.get(page.id), undefined);
  assert.deepEqual(registry.ofSession('session-1'), []);
  assert.equal(changes, 1);
});

test('closing the browser ends its pages as disconnected', () => {
  const registry = new PageRegistry();
  const browser = fakeBrowser();
  const connection = browser as unknown as ConnectedBrowser;
  registry.track(connection);
  const first = registry.adopt('session-1', connection, snapshot(1));
  const second = registry.adopt('session-1', connection, snapshot(2));

  const endings = new Map<string, PageEnding>();
  first.onEnded((ending) => endings.set(first.id, ending));
  second.onEnded((ending) => endings.set(second.id, ending));

  browser.close();

  assert.equal(endings.size, 2);
  assert.equal(endings.get(first.id), 'disconnected');
  assert.equal(endings.get(second.id), 'disconnected');
  assert.equal(registry.get(first.id), undefined);
  assert.equal(registry.get(second.id), undefined);
  assert.deepEqual(registry.ofSession('session-1'), []);
});

test('throws when adopting a page of a browser that is not tracked', () => {
  const registry = new PageRegistry();
  registry.track(fakeBrowser('Other Chrome') as unknown as ConnectedBrowser);
  const untracked = fakeBrowser();

  assert.throws(
    () => registry.adopt('session-1', untracked as unknown as ConnectedBrowser, snapshot(4)),
    /adopting a page of an untracked browser/,
  );
});

test("turns on an adopted page's Page domain, so that Chrome reports its dialogs", () => {
  const fake = fakeBrowser();
  const registry = new PageRegistry();
  registry.track(fake as unknown as ConnectedBrowser);
  registry.adopt('session-1', fake as unknown as ConnectedBrowser, snapshot(4));
  assert.deepEqual(fake.cdpCalls, [{ tabId: 4, method: 'Page.enable' }]);
});

test('follows a dialog from its opening to its closing, telling the page and the list', () => {
  const fake = fakeBrowser();
  const registry = new PageRegistry();
  registry.track(fake as unknown as ConnectedBrowser);
  const page = registry.adopt('session-1', fake as unknown as ConnectedBrowser, snapshot(4));
  let pageChanges = 0;
  let listChanges = 0;
  page.onChanged(() => pageChanges++);
  registry.onChange(() => listChanges++);

  fake.emit({
    type: 'cdp-event',
    tabId: 4,
    method: 'Page.javascriptDialogOpening',
    params: {
      url: 'https://example.com/4',
      message: 'Leave?',
      type: 'confirm',
      hasBrowserHandler: true,
    },
  });
  assert.deepEqual(page.dialog, {
    kind: 'confirm',
    message: 'Leave?',
    defaultPrompt: '',
    url: 'https://example.com/4',
  });
  fake.emit({
    type: 'cdp-event',
    tabId: 4,
    method: 'Page.javascriptDialogClosed',
    params: { result: true, userInput: '' },
  });
  assert.equal(page.dialog, undefined);
  assert.deepEqual([pageChanges, listChanges], [2, 2]);
});

test("adopts a page another page opened into the opener's session, and announces the opening", () => {
  const fake = fakeBrowser();
  const browser = fake as unknown as ConnectedBrowser;
  const registry = new PageRegistry();
  registry.track(browser);
  const opener = registry.adopt('session-1', browser, snapshot(4), { openedBy: 'user' });
  const openings: { page: ChromePage; opener: ChromePage; foreground: boolean }[] = [];
  registry.onPageOpened((opening) => openings.push(opening));

  fake.emit({
    type: 'page-opened',
    // The connector's group key would name the session too; the opener's session decides.
    page: snapshot(7, { groupKey: 'session-1' }),
    openerTabId: 4,
    foreground: true,
  });
  const popup = registry.ofSession('session-1').find((page) => page.tabId === 7);
  assert.ok(popup);
  assert.equal(popup.openedBy, 'page');
  assert.equal(popup.openerId, opener.id);
  assert.deepEqual(openings, [{ page: popup, opener, foreground: true }]);
});

test('adopts a page whose opener is gone into the group it opened in, announcing nothing', () => {
  const fake = fakeBrowser();
  const browser = fake as unknown as ConnectedBrowser;
  const registry = new PageRegistry();
  registry.track(browser);
  let openings = 0;
  registry.onPageOpened(() => openings++);
  fake.emit({
    type: 'page-opened',
    page: snapshot(9, { groupKey: 'session-2' }),
    openerTabId: 4,
    foreground: false,
  });
  const [page] = registry.ofSession('session-2');
  assert.equal(page?.openedBy, 'page');
  assert.equal(page?.openerId, undefined);
  assert.equal(openings, 0);
});

test("ends a browser's pages for a reason of the host's, and no other browser's", () => {
  const restarting = fakeBrowser('Dedicated Chrome');
  const other = fakeBrowser('Work Chrome');
  const registry = new PageRegistry();
  for (const fake of [restarting, other]) registry.track(fake as unknown as ConnectedBrowser);
  const ended = registry.adopt('session-1', restarting as unknown as ConnectedBrowser, snapshot(4));
  const kept = registry.adopt('session-1', other as unknown as ConnectedBrowser, snapshot(5));
  const endings: PageEnding[] = [];
  ended.onEnded((ending) => endings.push(ending));

  registry.endPagesOf(restarting as unknown as ConnectedBrowser, 'restarted');
  // The browser leaving afterwards ends nothing twice.
  restarting.close();
  assert.deepEqual(endings, ['restarted']);
  assert.deepEqual(registry.ofSession('session-1'), [kept]);
});

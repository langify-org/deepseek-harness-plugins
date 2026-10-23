import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CdpConnection } from '../../../../../src/host/chrome/cdp/cdp-connection.ts';
import type { ChromePage, PageEnding } from '../../../../../src/host/chrome/pages/page.ts';
import {
  type PageOpening,
  PageRegistry,
} from '../../../../../src/host/chrome/pages/page-registry.ts';
import { silentLog } from '../../../../../src/host/platform/log.ts';
import { FakeBrowser, settle } from '../../../../support/fake-browser.ts';

/** A registry following a fake browser's pages, as it follows Chrome's. */
async function tracked(
  sessionOfTarget?: (targetId: string) => Promise<string | undefined>,
): Promise<{ readonly browser: FakeBrowser; readonly pages: PageRegistry }> {
  const browser = new FakeBrowser();
  const pages = new PageRegistry(sessionOfTarget);
  await pages.track(new CdpConnection(browser, silentLog));
  return { browser, pages };
}

function only(pages: PageRegistry): ChromePage {
  const [page, ...others] = pages.all();
  assert.ok(page !== undefined && others.length === 0, `${pages.all().length} pages`);
  return page;
}

test("follows Chrome's page targets: discovered, and attached in flattened sessions", async () => {
  const { browser } = await tracked();
  const pageFilter = [{ type: 'page', exclude: false }];
  assert.deepEqual(browser.commands('Target.setDiscoverTargets')[0]?.params, {
    discover: true,
    filter: pageFilter,
  });
  assert.deepEqual(browser.commands('Target.setAutoAttach')[0]?.params, {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: true,
    filter: pageFilter,
  });
});

test('lets a new page run once its dialogs are followed, and leaves a running page alone', async () => {
  const { browser } = await tracked();
  browser.attachPage({ targetId: 'T1' }, 'S1', { waitingForDebugger: true });
  browser.attachPage({ targetId: 'T2' }, 'S2');
  await settle();
  await settle();
  assert.deepEqual(
    browser.sent
      .filter(
        ({ method }) => method === 'Page.enable' || method === 'Runtime.runIfWaitingForDebugger',
      )
      .map(({ method, sessionId }) => `${sessionId} ${method}`),
    ['S1 Page.enable', 'S2 Page.enable', 'S1 Runtime.runIfWaitingForDebugger'],
  );
});

test('adopts a page the user opened in Chrome as no session’s, and turns on its dialogs', async () => {
  const { browser, pages } = await tracked();
  browser.attachPage({ targetId: 'T1', url: 'https://example.com/', title: 'Example' }, 'S1');
  const page = only(pages);
  assert.match(page.id, /^p[0-9a-f]{6}$/);
  assert.deepEqual(
    {
      targetId: page.targetId,
      sessionId: page.sessionId,
      openedBy: page.openedBy,
      openerId: page.openerId,
      url: page.url,
      title: page.title,
    },
    {
      targetId: 'T1',
      sessionId: undefined,
      openedBy: 'user',
      openerId: undefined,
      url: 'https://example.com/',
      title: 'Example',
    },
  );
  await settle();
  assert.deepEqual(
    browser.commands('Page.enable').map(({ sessionId }) => sessionId),
    ['S1'],
  );
});

test('gives a page to the session that opened it, before or after Chrome reports it', async () => {
  const { browser, pages } = await tracked();
  pages.claim('T1', 'session-a', 'agent');
  const adopted = pages.whenAdopted('T1');
  browser.attachPage({ targetId: 'T1' }, 'S1');
  const first = await adopted;
  assert.deepEqual([first.sessionId, first.openedBy], ['session-a', 'agent']);

  browser.attachPage({ targetId: 'T2' }, 'S2');
  pages.claim('T2', 'session-b', 'user');
  const second = await pages.whenAdopted('T2');
  assert.deepEqual([second.sessionId, second.openedBy], ['session-b', 'user']);

  // A page keeps the session it belongs to.
  pages.claim('T1', 'session-b', 'user');
  assert.equal(first.sessionId, 'session-a');
});

test("adopts a page another page opened into the opener's session, and announces the opening", async () => {
  const { browser, pages } = await tracked();
  pages.claim('T1', 'session-a', 'agent');
  browser.attachPage({ targetId: 'T1' }, 'S1');
  const opener = await pages.whenAdopted('T1');
  const openings: PageOpening[] = [];
  pages.onPageOpened((opening) => openings.push(opening));

  browser.attachPage({ targetId: 'T2', openerId: 'T1', url: 'https://login/' }, 'S2');
  const popup = await pages.whenAdopted('T2');
  assert.deepEqual(
    [popup.sessionId, popup.openedBy, popup.openerId],
    ['session-a', 'page', opener.id],
  );
  assert.deepEqual(openings, [{ page: popup, opener }]);
});

test("follows a page's address and title, telling listeners only of changes", async () => {
  const { browser, pages } = await tracked();
  browser.attachPage({ targetId: 'T1', url: 'about:blank', title: '' }, 'S1');
  const page = only(pages);
  let pageChanges = 0;
  let listChanges = 0;
  page.onChanged(() => pageChanges++);
  pages.onChange(() => listChanges++);
  const info = { targetId: 'T1', type: 'page', url: 'https://a/', title: 'A', attached: true };
  browser.emit('Target.targetInfoChanged', { targetInfo: info });
  browser.emit('Target.targetInfoChanged', { targetInfo: info });
  assert.deepEqual([page.url, page.title, pageChanges, listChanges], ['https://a/', 'A', 1, 1]);
});

test('ends a page when its target goes, and every page when Chrome closes the connection', async () => {
  const { browser, pages } = await tracked();
  browser.attachPage({ targetId: 'T1' }, 'S1');
  browser.attachPage({ targetId: 'T2' }, 'S2');
  browser.attachPage({ targetId: 'T3' }, 'S3');
  const [third, second, first] = pages.all();
  const endings: Record<string, PageEnding> = {};
  for (const page of [first, second, third]) {
    page?.onEnded((ending) => {
      endings[page.targetId] = ending;
    });
  }
  browser.emit('Target.targetDestroyed', { targetId: 'T1' });
  browser.emit('Target.detachedFromTarget', { sessionId: 'S2' });
  browser.exit();
  assert.deepEqual(endings, { T1: 'closed', T2: 'closed', T3: 'chrome-stopped' });
  assert.deepEqual(pages.all(), []);
  assert.equal(first?.ending, 'closed');
});

test("follows a page's dialog from its opening to its closing", async () => {
  const { browser, pages } = await tracked();
  browser.attachPage({ targetId: 'T1' }, 'S1');
  const page = only(pages);
  let listChanges = 0;
  pages.onChange(() => listChanges++);
  browser.emit(
    'Page.javascriptDialogOpening',
    { url: 'https://a/', message: 'Leave?', type: 'confirm', hasBrowserHandler: true },
    'S1',
  );
  assert.deepEqual(page.dialog, {
    kind: 'confirm',
    message: 'Leave?',
    defaultPrompt: '',
    url: 'https://a/',
  });
  // Another session's dialog is not this page's.
  browser.emit('Page.javascriptDialogClosed', { result: true, userInput: '' }, 'S9');
  assert.notEqual(page.dialog, undefined);
  browser.emit('Page.javascriptDialogClosed', { result: true, userInput: '' }, 'S1');
  assert.equal(page.dialog, undefined);
  assert.equal(listChanges, 2);
});

test("sends a page's commands, and hears its events, in the page's own session", async () => {
  const { browser, pages } = await tracked();
  browser.attachPage({ targetId: 'T1' }, 'S1');
  browser.attachPage({ targetId: 'T2' }, 'S2');
  const page = pages.all().find((candidate) => candidate.targetId === 'T1');
  assert.ok(page);
  await page.send('Page.reload');
  assert.equal(browser.commands('Page.reload')[0]?.sessionId, 'S1');
  const loads: number[] = [];
  page.on('Page.loadEventFired', ({ timestamp }) => loads.push(timestamp));
  browser.emit('Page.loadEventFired', { timestamp: 1 }, 'S2');
  browser.emit('Page.loadEventFired', { timestamp: 2 }, 'S1');
  assert.deepEqual(loads, [2]);
  await page.close();
  assert.deepEqual(browser.commands('Target.closeTarget')[0]?.params, { targetId: 'T1' });
});

test("lists a session's pages and those it may use, the most recently used first", async () => {
  const { browser, pages } = await tracked();
  pages.claim('T1', 'session-a', 'agent');
  browser.attachPage({ targetId: 'T1' }, 'S1');
  browser.attachPage({ targetId: 'T2' }, 'S2');
  pages.claim('T3', 'session-b', 'agent');
  browser.attachPage({ targetId: 'T3' }, 'S3');
  const ids = (list: readonly ChromePage[]) => list.map((page) => page.targetId);
  assert.deepEqual(ids(pages.ofSession('session-a')), ['T1']);
  assert.deepEqual(ids(pages.reachableBy('session-a')), ['T2', 'T1']);
  const first = pages.all().find((page) => page.targetId === 'T1');
  pages.touch(first?.id ?? '');
  assert.deepEqual(ids(pages.reachableBy('session-a')), ['T1', 'T2']);
  // T3 came after T2.
  assert.deepEqual(ids(pages.reachableBy('session-b')), ['T3', 'T2']);
});

test('finds the page in front: one showing a dialog, else the focused one, else one in view', async () => {
  const { browser, pages } = await tracked();
  const views: Record<string, string> = { S1: 'hidden', S2: 'visible', S3: 'hidden' };
  browser.answer('Runtime.evaluate', ({ sessionId }) => ({
    result: { value: views[sessionId ?? ''] },
  }));
  for (const [target, cdpSession] of [
    ['T1', 'S1'],
    ['T2', 'S2'],
    ['T3', 'S3'],
  ] as const) {
    pages.claim(target, 'session-a', 'agent');
    browser.attachPage({ targetId: target }, cdpSession);
  }
  const byTarget = (targetId: string) => pages.all().find((page) => page.targetId === targetId);
  assert.equal(await pages.pageInFront('session-a'), byTarget('T2'));
  views['S3'] = 'focused';
  assert.equal(await pages.pageInFront('session-a'), byTarget('T3'));
  browser.emit(
    'Page.javascriptDialogOpening',
    { url: '', message: 'Hi', type: 'alert', hasBrowserHandler: true },
    'S1',
  );
  assert.equal(await pages.pageInFront('session-a'), byTarget('T1'));
});

test('asks a page whether it is in view in a world of its own, which the page cannot redefine', async () => {
  const { browser, pages } = await tracked();
  let worlds = 0;
  browser.answer('Page.createIsolatedWorld', () => ({ executionContextId: 100 + ++worlds }));
  let gone = false;
  browser.answer('Runtime.evaluate', ({ params }) =>
    gone && params['contextId'] === 101
      ? { error: 'Cannot find context with specified id' }
      : { result: { value: 'visible' } },
  );
  pages.claim('T1', 'session-a', 'agent');
  browser.attachPage({ targetId: 'T1' }, 'S1');
  const page = only(pages);
  assert.equal(await pages.pageInFront('session-a'), page);
  assert.equal(await pages.pageInFront('session-a'), page);
  assert.deepEqual(
    browser.commands('Runtime.evaluate').map(({ params }) => params['contextId']),
    [101, 101],
  );
  assert.deepEqual(browser.commands('Page.createIsolatedWorld')[0]?.params, {
    frameId: 'T1',
    worldName: 'dsh-chrome',
  });
  // The page went on to another document, and the world with the first.
  gone = true;
  assert.equal(await pages.pageInFront('session-a'), page);
  assert.equal(worlds, 2);
});

test('brings a page to the front, and returns once Chrome has it focused', async () => {
  const { browser, pages } = await tracked();
  let checks = 0;
  browser.answer('Runtime.evaluate', () => ({
    result: { value: ++checks < 3 ? 'visible' : 'focused' },
  }));
  browser.attachPage({ targetId: 'T1' }, 'S1');
  await only(pages).bringToFront();
  assert.deepEqual(browser.commands('Target.activateTarget')[0]?.params, { targetId: 'T1' });
  assert.equal(checks, 3);
});

test('gives up waiting for a page Chrome does not report', async () => {
  const { pages } = await tracked();
  await assert.rejects(pages.whenAdopted('T9', { timeoutMs: 20 }), /did not report/);
});

test("finds only the given session's pages in front, whatever the others show", async () => {
  const { browser, pages } = await tracked();
  browser.answer('Runtime.evaluate', () => ({ result: { value: 'focused' } }));
  pages.claim('T1', 'session-a', 'agent');
  pages.claim('T2', 'session-b', 'agent');
  browser.attachPage({ targetId: 'T1' }, 'S1');
  browser.attachPage({ targetId: 'T2' }, 'S2');
  const byTarget = (targetId: string) => pages.all().find((page) => page.targetId === targetId);
  assert.equal(await pages.pageInFront('session-a'), byTarget('T1'));
  assert.equal(await pages.pageInFront('session-b'), byTarget('T2'));
  assert.equal(await pages.pageInFront('session-c'), undefined);
  // A dialog in another session's page does not answer for this one.
  browser.emit(
    'Page.javascriptDialogOpening',
    { url: '', message: 'Hi', type: 'alert', hasBrowserHandler: true },
    'S2',
  );
  assert.equal(await pages.pageInFront('session-a'), byTarget('T1'));
  assert.equal(await pages.pageInFront('session-b'), byTarget('T2'));
});

test('gives a page no command claimed and no page opened to the session whose screen its window is on', async () => {
  const asked: string[] = [];
  const { browser, pages } = await tracked(async (targetId) => {
    asked.push(targetId);
    return targetId === 'T1' ? 'session-a' : undefined;
  });
  browser.attachPage({ targetId: 'T1' }, 'S1');
  browser.attachPage({ targetId: 'T2' }, 'S2');
  await settle();
  const byTarget = (targetId: string) => pages.all().find((page) => page.targetId === targetId);
  assert.deepEqual([byTarget('T1')?.sessionId, byTarget('T1')?.openedBy], ['session-a', 'user']);
  // A window on no session's screen stays no session's.
  assert.equal(byTarget('T2')?.sessionId, undefined);
  assert.deepEqual(asked, ['T1', 'T2']);
});

test('keeps the session a claim gave a page, without asking whose screen it is on', async () => {
  const asked: string[] = [];
  const { browser, pages } = await tracked(async (targetId) => {
    asked.push(targetId);
    return 'session-b';
  });
  pages.claim('T1', 'session-a', 'agent');
  browser.attachPage({ targetId: 'T1' }, 'S1');
  await settle();
  assert.equal(only(pages).sessionId, 'session-a');
  assert.deepEqual(asked, []);
});

test('shows a page only when it is hidden', async () => {
  const { browser, pages } = await tracked();
  let view = 'visible';
  browser.answer('Runtime.evaluate', () => ({ result: { value: view } }));
  browser.attachPage({ targetId: 'T1' }, 'S1');
  const page = only(pages);
  await page.show();
  view = 'focused';
  await page.show();
  assert.equal(browser.commands('Target.activateTarget').length, 0);
  view = 'hidden';
  await page.show();
  assert.deepEqual(
    browser.commands('Target.activateTarget').map(({ params }) => params),
    [{ targetId: 'T1' }],
  );
});

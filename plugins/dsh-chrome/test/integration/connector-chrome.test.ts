/**
 * The host side against a real Chrome: the runtime, the page and view pieces, the native
 * host relay and the connector extension, in a temporary dedicated profile on a private
 * display. Nothing touches the user's own Chrome.
 *
 * Needs a build (`pnpm build`), Google Chrome (or DSH_CHROME_TEST_EXECUTABLE) and Xvfb.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import type { CdpCommand } from '../../src/host/chrome/connector/cdp.ts';
import type { ConnectedBrowser } from '../../src/host/chrome/connector/connected-browser.ts';
import { installConnector } from '../../src/host/chrome/connector/install.ts';
import { ConnectorServer } from '../../src/host/chrome/connector/server.ts';
import {
  type DedicatedChrome,
  launchDedicatedChrome,
} from '../../src/host/chrome/dedicated-chrome/launch.ts';
import type { ChromePage, PageEnding } from '../../src/host/chrome/pages/page.ts';
import { type PageOpening, PageRegistry } from '../../src/host/chrome/pages/page-registry.ts';
import { click, navigate, press, type } from '../../src/host/page-operations/actions.ts';
import { ElementRefError, ElementRefs } from '../../src/host/page-operations/element-refs.ts';
import { parseKeyCombo } from '../../src/host/page-operations/keys.ts';
import { readPageText } from '../../src/host/page-operations/text.ts';
import { silentLog } from '../../src/host/platform/log.ts';
import { PLUGIN_VERSION } from '../../src/host/platform/package-files.ts';
import { PageInput } from '../../src/host/viewer/page-input.ts';
import {
  frameShowsLayout,
  PageScreen,
  type ScreenFrame,
} from '../../src/host/viewer/page-screen.ts';
import { LASTING_CONNECTION_MS } from '../../src/protocol/connector.ts';
import { chromeExecutable, distDir, missingRequirements } from '../support/environment.ts';
import {
  OPENER_PAGE_HTML,
  OPENER_PAGE_PATH,
  TEST_PAGE_HTML,
  TEST_PAGE_TITLE,
} from '../support/test-page.ts';
import { waitFor, withTimeout } from '../support/wait.ts';

let workDir = '';
let pageServer: Server | undefined;
let pageUrl = '';
let connectorServer: ConnectorServer | undefined;
let chrome: DedicatedChrome | undefined;
let browser: ConnectedBrowser | undefined;
let socketPath = '';
const pages = new PageRegistry();
/** Who waits for the next browser to connect. */
const connectionWaiters: ((browser: ConnectedBrowser) => void)[] = [];
/** When the latest browser connected. */
let connectedAt = 0;
/**
 * Whether the host tells the connector that someone sees Chrome's windows. The first tests
 * run Chrome as a user's own; later ones as DSH runs the dedicated Chrome, out of sight.
 */
let visibleWindows = true;

const missing = await missingRequirements({ chrome: true });

before(async () => {
  if (missing) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-it-'));
  pageServer = createServer((request, response) => {
    const html = request.url?.startsWith(OPENER_PAGE_PATH) ? OPENER_PAGE_HTML : TEST_PAGE_HTML;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((resolve) => pageServer?.listen(0, '127.0.0.1', resolve));
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/`;

  socketPath = join(workDir, 'connector.sock');
  const userDataDir = join(workDir, 'profile');
  const installed = await installConnector({
    distDir,
    dataDir: join(workDir, 'data'),
    socketPath,
    nodePath: process.execPath,
    profiles: [{ name: 'dedicated', userDataDir }],
  });
  const connected = nextConnection();
  connectorServer = await listen(pages);
  chrome = await launchDedicatedChrome({
    executable: chromeExecutable,
    userDataDir,
    extensionDir: installed.extensionDir,
    display: 'virtual',
    log: silentLog,
  });
  browser = await withTimeout(connected, 20_000, 'the connector did not connect');
});

after(async () => {
  await chrome?.close();
  await connectorServer?.close();
  await new Promise<void>((resolve) =>
    pageServer ? pageServer.close(() => resolve()) : resolve(),
  );
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

test('the connector reports the profile its native host manifest belongs to', {
  skip: missing,
}, () => {
  assert.equal(browser?.identity.profile, 'dedicated');
  assert.equal(browser?.identity.extensionVersion, PLUGIN_VERSION);
});

test('a page opens in Chrome and answers CDP commands', { skip: missing }, async () => {
  const page = await openTestPage('session-a');
  const { result } = await page.send('Runtime.evaluate', {
    expression: 'document.title',
    returnByValue: true,
  });
  assert.equal(result.value, TEST_PAGE_TITLE);
  await page.close();
});

test('a viewer gets frames laid out for its viewport, and its input reaches the page', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-b');
  const frames: ScreenFrame[] = [];
  const screen = new PageScreen(
    page,
    { jpegQuality: 60, hiddenFrameIntervalMs: 100, maxDeviceScaleFactor: 2 },
    silentLog,
  );
  screen.addViewer({
    viewport: { width: 480, height: 320, deviceScaleFactor: 1 },
    visible: true,
    showFrame: (frame) => frames.push(frame),
  });
  await waitFor(() =>
    frames.some((frame) => Math.round(frame.width) === 480 && Math.round(frame.height) === 320),
  );

  const box = await evaluate<{ x: number; y: number }>(
    page,
    `(() => { const r = document.getElementById('field').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  const input = new PageInput(page, silentLog);
  const click = { x: box.x, y: box.y, button: 'left', clickCount: 1, modifiers: 0 } as const;
  input.dispatch({ kind: 'mouse', action: 'down', ...click, buttons: 1 });
  input.dispatch({ kind: 'mouse', action: 'up', ...click, buttons: 0 });
  input.dispatch({ kind: 'text', text: '日本語' });
  input.dispatch({
    kind: 'key',
    action: 'down',
    key: 'Backspace',
    code: 'Backspace',
    keyCode: 8,
    text: '',
    modifiers: 0,
    repeat: false,
  });
  input.dispatch({
    kind: 'key',
    action: 'up',
    key: 'Backspace',
    code: 'Backspace',
    keyCode: 8,
    text: '',
    modifiers: 0,
    repeat: false,
  });
  await waitFor(
    async () => (await evaluate<string>(page, `document.getElementById('field').value`)) === '日本',
  );

  screen.dispose();
  await page.close();
});

test('a page hidden behind another tab keeps sending frames by capture', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-c');
  const frames: ScreenFrame[] = [];
  const screen = new PageScreen(
    page,
    { jpegQuality: 60, hiddenFrameIntervalMs: 100, maxDeviceScaleFactor: 2 },
    silentLog,
  );
  screen.addViewer({
    viewport: { width: 400, height: 300, deviceScaleFactor: 1 },
    visible: true,
    showFrame: (frame) => frames.push(frame),
  });
  await waitFor(() => frames.length > 0);

  const hidden = new Promise<void>((resolve) => {
    page.on('Page.screencastVisibilityChanged', ({ visible }) => {
      if (!visible) resolve();
    });
  });
  // Opening another page in the agent window makes it the active tab; the first is hidden.
  const cover = await openTestPage('session-c');
  await withTimeout(hidden, 5000, 'Chrome did not report the page hidden');
  const before = frames.length;
  await waitFor(() => frames.length >= before + 3);

  screen.dispose();
  await cover.close();
  await page.close();
});

test('a tab closed on the Chrome side ends its page', { skip: missing }, async () => {
  const page = await openTestPage('session-d');
  const ending = new Promise((resolve) => page.onEnded(resolve));
  // The page closes its own tab, as if the user closed it in Chrome: a tab with one history
  // entry may close itself. The command may get no answer once the tab is gone.
  await page.send('Runtime.evaluate', { expression: 'window.close()' }).catch(() => {});
  assert.equal(await withTimeout(ending, 5000, 'the page did not end'), 'closed');
  assert.equal(pages.get(page.id), undefined);
});

test('the connector refuses CDP methods outside what the plugin uses', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-e');
  assert.ok(browser);
  // The host's types would not let its code ask for these; a process posing as DSH could.
  for (const method of [
    'Network.getCookies',
    'Network.enable',
    'Storage.getCookies',
    'Fetch.enable',
  ]) {
    await assert.rejects(
      browser.sendCdp(page.tabId, method as CdpCommand, {}),
      { code: 'method-denied' },
      method,
    );
  }
  // Allowed methods, with parameters that would reach past the page's own scripts: another
  // world on the page (an extension's), a local file, a script injected into every frame.
  const refusedCalls: [CdpCommand, object][] = [
    ['Runtime.evaluate', { expression: 'chrome.runtime.id', contextId: 2 }],
    ['Page.navigate', { url: 'file:///etc/hostname' }],
    ['Page.reload', { scriptToEvaluateOnLoad: 'document.title = "injected"' }],
  ];
  for (const [method, params] of refusedCalls) {
    await assert.rejects(
      browser.sendCdp(page.tabId, method, params),
      { code: 'method-denied' },
      method,
    );
  }
  await page.close();
});

test('the agent finds elements in a snapshot and operates them by ref', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-f');
  await waitFor(async () => (await evaluate<string>(page, 'document.readyState')) === 'complete');
  const refs = new ElementRefs();
  const snapshot = await refs.snapshot(page, 20_000);
  const fieldRef = /textbox "Field" \[ref=(e\d+)\]/.exec(snapshot.text)?.[1];
  const buttonRef = /button "Go" \[ref=(e\d+)\]/.exec(snapshot.text)?.[1];
  assert.ok(fieldRef !== undefined && buttonRef !== undefined, snapshot.text);
  const field = await refs.resolve(page, fieldRef);

  await type(page, 'hello', { element: field, replace: true, submit: false });
  assert.equal(await evaluate<string>(page, "document.getElementById('field').value"), 'hello');
  await type(page, 'world', { element: field, replace: true, submit: false });
  assert.equal(await evaluate<string>(page, "document.getElementById('field').value"), 'world');
  await press(page, parseKeyCombo('Backspace'));
  assert.equal(await evaluate<string>(page, "document.getElementById('field').value"), 'worl');

  await click(page, await refs.resolve(page, buttonRef), 1);
  await waitFor(
    async () =>
      (await evaluate<string>(page, "document.getElementById('go').textContent")) === 'Clicked',
  );
  await page.close();
});

test('an element ref stops resolving once the page shows another document', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-i');
  await waitFor(async () => (await evaluate<string>(page, 'document.readyState')) === 'complete');
  const refs = new ElementRefs();
  const snapshot = await refs.snapshot(page, 20_000);
  const buttonRef = /button "Go" \[ref=(e\d+)\]/.exec(snapshot.text)?.[1];
  assert.ok(buttonRef !== undefined, snapshot.text);
  await refs.resolve(page, buttonRef);

  // A same-document navigation keeps the refs; a new document does not.
  await evaluate(page, "history.pushState(null, '', '?route')");
  await refs.resolve(page, buttonRef);
  assert.equal(await navigate(page, { url: `${pageUrl}?other` }), true);
  await assert.rejects(refs.resolve(page, buttonRef), ElementRefError);
  await page.close();
});

test('the agent reads page text and navigates', { skip: missing }, async () => {
  const page = await openTestPage('session-g');
  await waitFor(async () => (await evaluate<string>(page, 'document.readyState')) === 'complete');
  const text = await readPageText(page, 10_000);
  assert.equal(text.title, TEST_PAGE_TITLE);
  assert.match(text.text, /A shared page for testing\./);
  assert.equal(await navigate(page, { url: `${pageUrl}?second` }), true);
  assert.equal(await evaluate<string>(page, 'location.search'), '?second');
  assert.equal(await navigate(page, { history: 'back' }), true);
  assert.equal(await evaluate<string>(page, 'location.search'), '');
  await page.close();
});

test('a viewer of the hidden dedicated Chrome gets frames at its layout only, steadily', {
  skip: missing,
}, async () => {
  await arrangeWindows({ visible: false });
  const page = await openTestPage('session-s');
  const frames: { readonly width: number; readonly height: number; readonly at: number }[] = [];
  let viewport = { width: 640, height: 400, deviceScaleFactor: 1 };
  const viewer = {
    get viewport() {
      return viewport;
    },
    visible: true,
    showFrame: (frame: ScreenFrame) =>
      frames.push({ width: frame.width, height: frame.height, at: performance.now() }),
  };
  const screen = new PageScreen(
    page,
    { jpegQuality: 60, hiddenFrameIntervalMs: 250, maxDeviceScaleFactor: 2 },
    silentLog,
  );
  const sizeOf = (frame: { width: number; height: number }) =>
    `${Math.round(frame.width)}x${Math.round(frame.height)}`;
  let start = 0;
  /** The frames from the first that shows the layout on, over three seconds. */
  const streamAt = async (layout: { width: number; height: number }) => {
    const shows = (frame: (typeof frames)[number], index: number) =>
      index >= start && frameShowsLayout(frame, layout);
    await waitFor(() => frames.some(shows));
    const first = frames.findIndex(shows);
    await sleep(3000);
    return frames.slice(first);
  };
  /** The sizes of the frames that do not show the layout: those a viewer would flicker to. */
  const otherSizes = (streamed: typeof frames, layout: { width: number; height: number }) =>
    streamed.filter((frame) => !frameShowsLayout(frame, layout)).map(sizeOf);
  screen.addViewer(viewer);
  try {
    const streamed = await streamAt(viewport);
    // The page's clock repaints every 50 ms, and each repaint is a frame.
    assert.ok(streamed.length >= 30, `${streamed.length} frames in 3 s`);
    assert.deepEqual(otherSizes(streamed, viewport), []);
    const gaps = streamed.slice(1).map((frame, index) => frame.at - (streamed[index]?.at ?? 0));
    assert.ok(Math.max(...gaps) < 500, `the longest wait for a frame was ${Math.max(...gaps)} ms`);

    start = frames.length;
    viewport = { width: 900, height: 560, deviceScaleFactor: 1 };
    screen.viewportChanged(viewer);
    assert.deepEqual(otherSizes(await streamAt(viewport), viewport), []);
  } finally {
    screen.dispose();
    await page.close();
  }
});

test('pages a page opens join its session, in front or behind as Chrome opened them', {
  skip: missing,
}, async () => {
  await arrangeWindows({ visible: false });
  const opener = await openTestPage('session-o', `${pageUrl}${OPENER_PAGE_PATH.slice(1)}`);
  await waitFor(async () => (await evaluate<string>(opener, 'document.readyState')) === 'complete');
  const openings: PageOpening[] = [];
  const stop = pages.onPageOpened((opening) => openings.push(opening));
  try {
    await clickElement(opener, 'popup');
    await waitFor(() => openings.length === 1, 10_000, 'the popup');
    // Ctrl+click opens a link's tab behind the page; a plain click, in front of it.
    await clickElement(opener, 'tab', CTRL);
    await waitFor(() => openings.length === 2, 10_000, 'the background tab');
    await clickElement(opener, 'tab');
    await waitFor(() => openings.length === 3, 10_000, 'the new tab');
    assert.deepEqual(
      openings.map(({ opener: by, foreground }) => ({ by: by.id, foreground })),
      [
        { by: opener.id, foreground: true },
        { by: opener.id, foreground: false },
        { by: opener.id, foreground: true },
      ],
    );
    // Each page has a window of its own, so the opener is still its window's active tab.
    await waitFor(
      async () => (await evaluate<string>(opener, 'document.visibilityState')) === 'visible',
      10_000,
      'the opener to stay in view',
    );
    for (const { page } of openings) {
      assert.equal(page.sessionId, 'session-o');
      assert.equal(page.openedBy, 'page');
      assert.equal(page.openerId, opener.id);
      await waitFor(() => page.url === pageUrl, 10_000, `${page.id} to load`);
    }
  } finally {
    stop();
    for (const { page } of openings) await page.close().catch(() => {});
    await opener.close();
  }
});

test('a dialog of a page brought to the front is reported until it is answered', {
  skip: missing,
}, async () => {
  await arrangeWindows({ visible: false });
  const page = await openTestPage('session-d', `${pageUrl}${OPENER_PAGE_PATH.slice(1)}`);
  await waitFor(async () => (await evaluate<string>(page, 'document.readyState')) === 'complete');
  // Chrome answers the dialogs of a page that is not in front itself; the popups of the test
  // before took the focus.
  await page.bringToFront();
  // The click returns once the page has handled it, which waits for the answer.
  const clicked = clickElement(page, 'ask');
  await waitFor(() => page.dialog !== undefined, 10_000, 'the dialog');
  assert.deepEqual(page.dialog, {
    kind: 'confirm',
    message: 'Proceed?',
    defaultPrompt: '',
    url: `${pageUrl}${OPENER_PAGE_PATH.slice(1)}`,
  });
  await page.send('Page.handleJavaScriptDialog', { accept: true });
  await clicked;
  await waitFor(() => page.dialog === undefined, 10_000, 'the dialog to close');
  assert.equal(
    await evaluate<string>(page, "document.getElementById('answer').textContent"),
    'true',
  );
  await page.close();
});

test('a page keeps its id when the host restarts while Chrome keeps running', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-h');
  const ended = new Promise<PageEnding>((resolve) => page.onEnded(resolve));
  // The connector waits for a host's restart only once its connection has lasted.
  const lasting = connectedAt + LASTING_CONNECTION_MS + 500 - Date.now();
  if (lasting > 0) await new Promise((resolve) => setTimeout(resolve, lasting));
  await connectorServer?.close();
  assert.equal(await withTimeout(ended, 5000, 'the page outlived its host'), 'disconnected');

  // The new host knows nothing; the connector reconnects and reports the pages it kept.
  const restarted = new PageRegistry();
  const reconnected = nextConnection();
  connectorServer = await listen(restarted);
  browser = await withTimeout(reconnected, 20_000, 'the connector did not reconnect');
  const reported = (await browser.listPages()).find(
    (snapshot) => snapshot.groupKey === 'session-h',
  );
  assert.ok(reported, 'the connector did not report the page');
  const adopted = restarted.adopt(reported.groupKey, browser, reported);
  assert.equal(adopted.id, page.id);
  assert.equal(await evaluate<string>(adopted, 'document.title'), TEST_PAGE_TITLE);
  await adopted.close();
});

/** A connector server that hands the browsers it accepts to the registry and the waiters. */
function listen(registry: PageRegistry): Promise<ConnectorServer> {
  return ConnectorServer.listen({
    socketPath,
    // The built connector's version: another version would make it reload.
    connectorVersion: PLUGIN_VERSION,
    log: silentLog,
    visibleWindows: () => visibleWindows,
    onBrowser: (connected) => {
      connectedAt = Date.now();
      registry.track(connected);
      connectionWaiters.shift()?.(connected);
    },
  });
}

/** Has the connector arrange Chrome's windows anew: it reconnects, and the welcome says how. */
async function arrangeWindows({ visible }: { visible: boolean }): Promise<void> {
  if (browser?.visibleWindows === visible) return;
  visibleWindows = visible;
  // The connector reconnects at once only after a connection that lasted.
  const lasting = connectedAt + LASTING_CONNECTION_MS + 500 - Date.now();
  if (lasting > 0) await sleep(lasting);
  const reconnected = nextConnection();
  browser?.disconnect();
  browser = await withTimeout(reconnected, 20_000, 'the connector did not reconnect');
}

function nextConnection(): Promise<ConnectedBrowser> {
  return new Promise((resolve) => connectionWaiters.push(resolve));
}

async function openTestPage(sessionId: string, url = pageUrl): Promise<ChromePage> {
  assert.ok(browser, 'no browser connected');
  const snapshot = await browser.openPage(url, { key: sessionId, title: sessionId });
  return pages.adopt(sessionId, browser, snapshot);
}

/** CDP's modifier bit for Ctrl. */
const CTRL = 2;

/** Clicks the middle of an element as a user would, so the page sees a user gesture. */
async function clickElement(page: ChromePage, id: string, modifiers = 0): Promise<void> {
  const { x, y } = await evaluate<{ x: number; y: number }>(
    page,
    `(() => { const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  const mouse = { x, y, button: 'left', clickCount: 1, modifiers } as const;
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...mouse });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...mouse });
}

async function evaluate<T>(page: ChromePage, expression: string): Promise<T> {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
  return result.value as T;
}

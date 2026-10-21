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
import { click, navigate, press, type } from '../../src/host/page/actions.ts';
import { parseKeyCombo } from '../../src/host/page/keys.ts';
import { readSnapshot } from '../../src/host/page/snapshot.ts';
import { readPageText } from '../../src/host/page/text.ts';
import type { ConnectedBrowser } from '../../src/host/runtime/connected-browser.ts';
import { installConnector } from '../../src/host/runtime/connector-install.ts';
import { ConnectorServer } from '../../src/host/runtime/connector-server.ts';
import {
  type DedicatedChrome,
  launchDedicatedChrome,
} from '../../src/host/runtime/dedicated-chrome.ts';
import { silentLog } from '../../src/host/runtime/log.ts';
import { PLUGIN_VERSION } from '../../src/host/runtime/package-files.ts';
import { type ChromePage, type PageEnding, PageRegistry } from '../../src/host/runtime/pages.ts';
import { PageInput } from '../../src/host/view/page-input.ts';
import { PageScreen, type ScreenFrame } from '../../src/host/view/page-screen.ts';
import { chromeExecutable, distDir, missingRequirements } from '../support/environment.ts';
import { TEST_PAGE_HTML, TEST_PAGE_TITLE } from '../support/test-page.ts';
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

const missing = await missingRequirements({ chrome: true });

before(async () => {
  if (missing) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-it-'));
  pageServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TEST_PAGE_HTML);
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
  // The page closes its own tab, as if the user closed it in Chrome. The command may get
  // no answer: the tab is gone before Chrome replies.
  await page.send('Page.close').catch(() => {});
  assert.equal(await withTimeout(ending, 5000, 'the page did not end'), 'closed');
  assert.equal(pages.get(page.id), undefined);
});

test('the connector refuses CDP methods that read cookies', { skip: missing }, async () => {
  const page = await openTestPage('session-e');
  await assert.rejects(page.send('Network.getCookies'), { code: 'method-denied' });
  await page.close();
});

test('the agent finds elements in a snapshot and operates them by ref', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-f');
  await waitFor(async () => (await evaluate<string>(page, 'document.readyState')) === 'complete');
  const snapshot = await readSnapshot(page, 20_000);
  const fieldRef = /textbox "Field" \[ref=(e\d+)\]/.exec(snapshot.text)?.[1];
  const buttonRef = /button "Go" \[ref=(e\d+)\]/.exec(snapshot.text)?.[1];
  assert.ok(fieldRef !== undefined && buttonRef !== undefined, snapshot.text);

  await type(page, 'hello', { ref: fieldRef, replace: true, submit: false });
  assert.equal(await evaluate<string>(page, "document.getElementById('field').value"), 'hello');
  await type(page, 'world', { ref: fieldRef, replace: true, submit: false });
  assert.equal(await evaluate<string>(page, "document.getElementById('field').value"), 'world');
  await press(page, parseKeyCombo('Backspace'));
  assert.equal(await evaluate<string>(page, "document.getElementById('field').value"), 'worl');

  await click(page, buttonRef, 1);
  await waitFor(
    async () =>
      (await evaluate<string>(page, "document.getElementById('go').textContent")) === 'Clicked',
  );
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

test('a page keeps its id when the host restarts while Chrome keeps running', {
  skip: missing,
}, async () => {
  const page = await openTestPage('session-h');
  const ended = new Promise<PageEnding>((resolve) => page.onEnded(resolve));
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
    onBrowser: (connected) => {
      registry.track(connected);
      connectionWaiters.shift()?.(connected);
    },
  });
}

function nextConnection(): Promise<ConnectedBrowser> {
  return new Promise((resolve) => connectionWaiters.push(resolve));
}

async function openTestPage(sessionId: string): Promise<ChromePage> {
  assert.ok(browser, 'no browser connected');
  const snapshot = await browser.openPage(pageUrl, { key: sessionId, title: sessionId });
  return pages.adopt(sessionId, browser, snapshot);
}

async function evaluate<T>(page: ChromePage, expression: string): Promise<T> {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
  return result.value as T;
}

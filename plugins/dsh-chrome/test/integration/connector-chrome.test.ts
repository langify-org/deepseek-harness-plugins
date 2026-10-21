/**
 * End-to-end through a real Chrome: the plugin's runtime and viewer pieces, the native
 * host relay, and the connector extension, in a temporary dedicated profile on a
 * virtual display. Nothing touches the user's own Chrome.
 *
 * Needs a build (`pnpm build`), Google Chrome (or DSH_CHROME_TEST_EXECUTABLE) and Xvfb.
 */
import assert from 'node:assert/strict';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
import { type ChromePage, PageRegistry } from '../../src/host/runtime/pages.ts';
import { PageInput } from '../../src/host/view/page-input.ts';
import { PageScreen, type ScreenFrame } from '../../src/host/view/page-screen.ts';

const executable = process.env['DSH_CHROME_TEST_EXECUTABLE'] ?? 'google-chrome-stable';
const distDir = fileURLToPath(new URL('../../dist', import.meta.url));

const TEST_PAGE = `<!doctype html>
<title>dsh-chrome test page</title>
<input id="field" aria-label="Field" style="position:absolute;left:20px;top:20px;width:200px;height:30px">
<p id="clock" style="position:absolute;left:20px;top:80px">0</p>
<button id="go" style="position:absolute;left:20px;top:140px" onclick="this.textContent = 'Clicked'">Go</button>
<p style="position:absolute;left:20px;top:200px">A shared page for testing.</p>
<script>
  let ticks = 0;
  setInterval(() => { document.getElementById('clock').textContent = String(++ticks); }, 50);
</script>`;

let workDir = '';
let pageServer: Server | undefined;
let pageUrl = '';
let connectorServer: ConnectorServer | undefined;
let chrome: DedicatedChrome | undefined;
let browser: ConnectedBrowser | undefined;
const pages = new PageRegistry();

const missing = await missingRequirements();

before(async () => {
  if (missing !== undefined) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-it-'));
  pageServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TEST_PAGE);
  });
  await new Promise<void>((resolve) => pageServer?.listen(0, '127.0.0.1', resolve));
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/`;

  const socketPath = join(workDir, 'connector.sock');
  const userDataDir = join(workDir, 'profile');
  const installed = await installConnector({
    distDir,
    dataDir: join(workDir, 'data'),
    socketPath,
    nodePath: process.execPath,
    profiles: [{ name: 'dedicated', userDataDir }],
  });
  let onBrowser: (browser: ConnectedBrowser) => void = () => {};
  const connected = new Promise<ConnectedBrowser>((resolve) => {
    onBrowser = resolve;
  });
  connectorServer = await ConnectorServer.listen({
    socketPath,
    // The built connector's version: another version would make it reload.
    connectorVersion: PLUGIN_VERSION,
    log: silentLog,
    onBrowser: (connectedBrowser) => {
      pages.track(connectedBrowser);
      onBrowser(connectedBrowser);
    },
  });
  chrome = await launchDedicatedChrome({
    executable,
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
  assert.equal(result.value, 'dsh-chrome test page');
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
  assert.equal(text.title, 'dsh-chrome test page');
  assert.match(text.text, /A shared page for testing\./);
  assert.equal(await navigate(page, { url: `${pageUrl}?second` }), true);
  assert.equal(await evaluate<string>(page, 'location.search'), '?second');
  assert.equal(await navigate(page, { history: 'back' }), true);
  assert.equal(await evaluate<string>(page, 'location.search'), '');
  await page.close();
});

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

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(message)), timeoutMs),
    ),
  ]);
}

/** Why the suite cannot run here, or `undefined` when it can. */
async function missingRequirements(): Promise<string | undefined> {
  if (process.platform !== 'linux') return 'needs Linux (Xvfb)';
  try {
    await access(join(distDir, 'extension', 'manifest.json'));
  } catch {
    return 'needs a build: run `pnpm build` first';
  }
  for (const program of [executable, 'Xvfb']) {
    if (!(await onPath(program))) return `needs ${program} on PATH`;
  }
  return undefined;
}

async function onPath(program: string): Promise<boolean> {
  if (program.includes('/'))
    return access(program).then(
      () => true,
      () => false,
    );
  for (const directory of (process.env['PATH'] ?? '').split(delimiter)) {
    if (
      await access(join(directory, program)).then(
        () => true,
        () => false,
      )
    )
      return true;
  }
  return false;
}

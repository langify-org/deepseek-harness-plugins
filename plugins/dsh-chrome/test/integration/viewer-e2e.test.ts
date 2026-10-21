/**
 * The path the user's hands take, end to end. The built browser module renders the Chrome
 * tab in a real (headless) Chrome and connects through DSH's web server and connection
 * service to the built host plugin. The plugin starts its dedicated Chrome on a private
 * display, opens the page there through the connector, and streams it to the tab; clicks,
 * text, input method composition and keys typed in the tab reach that page. The agent's
 * request for help and adding the page to a message are exercised through the tab too.
 *
 * Needs a build (`pnpm build`), Google Chrome (or DSH_CHROME_TEST_EXECUTABLE) and Xvfb.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import packageJson from '../../package.json' with { type: 'json' };
import { fitFrame } from '../../src/client/viewer/frame-fit.ts';
import type { ChromeService } from '../../src/host/runtime/chrome-service.ts';
import type { ChromePage } from '../../src/host/runtime/pages.ts';
import { type DshHost, startDshHost } from '../support/dsh-host.ts';
import { chromeExecutable, distDir, missingRequirements } from '../support/environment.ts';
import { type HeadlessTab, openHeadlessTab } from '../support/headless-chrome.ts';
import { TEST_PAGE_HTML, TEST_PAGE_TITLE } from '../support/test-page.ts';
import { HARNESS_PATH, serveViewerHarness } from '../support/viewer-harness.ts';
import { waitFor } from '../support/wait.ts';

const SESSION_ID = 'e2e-session';
const TEST_PAGE_PATH = '/test-page';

const skip = await missingRequirements({ chrome: true });

let workDir = '';
let host: DshHost | undefined;
let chrome: ChromeService | undefined;
let viewer: HeadlessTab | undefined;

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-e2e-'));
  host = await startDshHost();
  const { root } = host;
  const plugin = await import(pathToFileURL(join(distDir, 'host', 'index.js')).href);
  await root.plugin(plugin, {
    dailyProfile: { enabled: false },
    dedicatedProfile: {
      enabled: true,
      executable: chromeExecutable,
      userDataDir: join(workDir, 'dedicated'),
      display: 'virtual',
    },
    defaultProfile: 'dedicated',
    dataDir: join(workDir, 'data'),
    connectorSocketPath: join(workDir, 'connector.sock'),
  });
  await waitFor(
    () => root.get('chrome')?.extensionDir !== undefined,
    10_000,
    'the plugin to start',
  );
  chrome = root.get('chrome');
  root.webServer.register({
    kind: 'exact',
    path: TEST_PAGE_PATH,
    handler: (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TEST_PAGE_HTML);
    },
  });
  serveViewerHarness(root.webServer, packageJson.name, SESSION_ID);
  viewer = await openHeadlessTab(join(workDir, 'viewer'), `${host.origin}${HARNESS_PATH}/`);
});

after(async () => {
  await viewer?.close();
  await host?.dispose();
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

test('the module registers a kept-mounted Chrome tab type', { skip }, async () => {
  const tab = requireViewer();
  await waitFor(async () => tab.evaluate<boolean>('window.__registeredTab !== undefined'));
  assert.deepEqual(await tab.evaluate('window.__registeredTab'), {
    kind: 'chrome',
    keepMounted: true,
  });
});

test('an address entered in the tab opens the page in Chrome and shows it', { skip }, async () => {
  const tab = requireViewer();
  const address = await waitForElement(tab, 'input[aria-label="Address"]');
  await tab.click(address.x, address.y);
  await tab.send('Input.insertText', { text: `${requireHost().origin}${TEST_PAGE_PATH}` });
  await tab.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    text: '\r',
  });
  await tab.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
  });

  // The dedicated Chrome starts on first use, so the first page takes a while.
  await waitFor(() => requireChrome().pagesOf(SESSION_ID).length === 1, 45_000, 'the page to open');
  await waitFor(() => canvasShowsAFrame(tab), 20_000, 'a frame in the tab');
  assert.equal(await targetEvaluate<string>('document.title'), TEST_PAGE_TITLE);
});

test('the page is laid out at the size of the tab that shows it', { skip }, async () => {
  const tab = requireViewer();
  const canvas = await waitForElement(tab, 'canvas');
  await waitFor(
    async () =>
      Math.abs((await targetEvaluate<number>('innerWidth')) - canvas.width) <= 1 &&
      Math.abs((await targetEvaluate<number>('innerHeight')) - canvas.height) <= 1,
    10_000,
    'the page to follow the tab size',
  );
});

test('clicks, text, composed text and keys from the tab reach the page', { skip }, async () => {
  const tab = requireViewer();
  const field = await targetEvaluate<{ x: number; y: number }>(
    `(() => { const r = document.getElementById('field').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  const point = await viewerPointFor(tab, field);
  await tab.click(point.x, point.y);
  await waitFor(
    async () => (await targetEvaluate<string>('document.activeElement?.id ?? ""')) === 'field',
    10_000,
    'the field to take focus',
  );

  await tab.send('Input.insertText', { text: '日本語' });
  await waitFor(async () => (await fieldValue()) === '日本語', 10_000, 'typed text');

  // An input method composes in the tab; only the finished text reaches the page.
  await tab.send('Input.imeSetComposition', { text: 'てすと', selectionStart: 3, selectionEnd: 3 });
  assert.equal(await fieldValue(), '日本語');
  await tab.send('Input.insertText', { text: 'テスト' });
  await waitFor(async () => (await fieldValue()) === '日本語テスト', 10_000, 'composed text');

  await tab.pressKey('Backspace', 'Backspace', 8);
  await waitFor(async () => (await fieldValue()) === '日本語テス', 10_000, 'a key press');
});

test("the agent's request for help appears in the tab and takes the user's answer", {
  skip,
}, async () => {
  const tab = requireViewer();
  const answer = requireChrome().helpRequests.ask(
    sharedPage(),
    'Please sign in to continue.',
    AbortSignal.timeout(20_000),
  );
  await waitFor(
    async () =>
      (
        await tab.evaluate<string>(`document.querySelector('[role="alert"]')?.textContent ?? ''`)
      ).includes('Please sign in to continue.'),
    10_000,
    'the request in the tab',
  );
  await tab.evaluate(
    `[...document.querySelectorAll('[role="alert"] button')].find((b) => b.textContent === 'Done').click()`,
  );
  assert.equal(await answer, 'done');
  await waitFor(
    async () => tab.evaluate<boolean>(`document.querySelector('[role="alert"]') === null`),
    10_000,
    'the request to close',
  );
});

test('the page text and a screenshot can be added to the message', { skip }, async () => {
  const tab = requireViewer();
  await tab.evaluate(
    `document.querySelector('button[aria-label="Add the page text to your message"]').click()`,
  );
  await waitFor(
    async () => (await tab.evaluate<number>('window.__attached.length')) === 1,
    10_000,
    'the page text',
  );
  const text = await tab.evaluate<{ name: string; type: string; content: string }>(
    `(async () => { const f = window.__attached[0]; return { name: f.name, type: f.type, content: await f.text() }; })()`,
  );
  assert.equal(text.type, 'text/markdown');
  assert.match(text.name, /\.md$/);
  assert.match(text.content, new RegExp(`^# ${TEST_PAGE_TITLE}`));
  assert.match(text.content, /A shared page for testing\./);

  await tab.evaluate(
    `document.querySelector('button[aria-label="Add a screenshot to your message"]').click()`,
  );
  await waitFor(
    async () => (await tab.evaluate<number>('window.__attached.length')) === 2,
    10_000,
    'the screenshot',
  );
  const image = await tab.evaluate<{ type: string; size: number }>(
    `({ type: window.__attached[1].type, size: window.__attached[1].size })`,
  );
  assert.equal(image.type, 'image/jpeg');
  assert.ok(image.size > 0);
  assert.match(await tab.evaluate<string>('document.body.textContent'), /Added to your message\./);
});

function requireViewer(): HeadlessTab {
  assert.ok(viewer, 'the viewer did not start');
  return viewer;
}

function requireHost(): DshHost {
  assert.ok(host, 'the host did not start');
  return host;
}

function requireChrome(): ChromeService {
  assert.ok(chrome, 'the plugin did not start');
  return chrome;
}

function sharedPage(): ChromePage {
  const page = requireChrome().pagesOf(SESSION_ID)[0];
  assert.ok(page, 'no page is shared');
  return page;
}

async function targetEvaluate<T>(expression: string): Promise<T> {
  const { result, exceptionDetails } = await sharedPage().send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
  return result.value as T;
}

function fieldValue(): Promise<string> {
  return targetEvaluate<string>(`document.getElementById('field').value`);
}

/** The centre and size of the first element matching the selector, once it exists. */
async function waitForElement(
  tab: HeadlessTab,
  selector: string,
): Promise<{ x: number; y: number; left: number; top: number; width: number; height: number }> {
  const read = `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.x, top: r.y, width: r.width, height: r.height }; })()`;
  let found: Awaited<ReturnType<typeof waitForElement>> | null = null;
  await waitFor(
    async () => {
      found = await tab.evaluate(read);
      return found !== null;
    },
    10_000,
    selector,
  );
  assert.ok(found);
  return found;
}

/** Whether the tab's canvas has drawn a frame: its centre pixel is no longer transparent. */
function canvasShowsAFrame(tab: HeadlessTab): Promise<boolean> {
  return tab.evaluate<boolean>(
    `(() => { const c = document.querySelector('canvas'); if (!c || c.width === 0) return false; return c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0; })()`,
  );
}

/** Where a point of the shared page is drawn in the tab, in the tab's CSS pixels. */
async function viewerPointFor(
  tab: HeadlessTab,
  pagePoint: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const canvas = await waitForElement(tab, 'canvas');
  const frame = {
    width: await targetEvaluate<number>('innerWidth'),
    height: await targetEvaluate<number>('innerHeight'),
  };
  const area = fitFrame({ width: canvas.width, height: canvas.height }, frame);
  return {
    x: canvas.left + area.x + (pagePoint.x * area.width) / frame.width,
    y: canvas.top + area.y + (pagePoint.y * area.height) / frame.height,
  };
}

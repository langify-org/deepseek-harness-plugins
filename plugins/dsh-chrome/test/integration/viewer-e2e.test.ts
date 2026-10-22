/**
 * The whole path a user takes: the built browser module, with noVNC, in a headless Chrome
 * standing in for DSH's web client, through DSH's web server and connection service, to
 * Chrome on its screen.
 *
 * Needs a build (`pnpm build`), Google Chrome (or DSH_CHROME_TEST_EXECUTABLE), Xvnc and
 * Openbox.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import packageJson from '../../package.json' with { type: 'json' };
import type { ChromeService } from '../../src/host/chrome/chrome-service.ts';
import type { ChromePage } from '../../src/host/chrome/pages/page.ts';
import { type DshHost, startDshHost } from '../support/dsh-host.ts';
import {
  chromeExecutable,
  distDir,
  missingRequirements,
  windowManagerExecutable,
  xvncExecutable,
} from '../support/environment.ts';
import { type HeadlessTab, openHeadlessTab } from '../support/headless-chrome.ts';
import { TEST_PAGE_HTML, TEST_PAGE_TITLE } from '../support/test-page.ts';
import { HARNESS_PATH, serveViewerHarness } from '../support/viewer-harness.ts';
import { waitFor } from '../support/wait.ts';

const SESSION_ID = 'e2e-session';

const skip = await missingRequirements({ chrome: true });

let workDir = '';
let host: DshHost | undefined;
let chrome: ChromeService | undefined;
let viewer: HeadlessTab | undefined;
let pageServer: Server | undefined;
let pageUrl = '';

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-e2e-'));
  pageServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(TEST_PAGE_HTML);
  });
  await new Promise<void>((resolve) => pageServer?.listen(0, '127.0.0.1', resolve));
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/`;
  host = await startDshHost();
  const { root } = host;
  await root.plugin(await import(pathToFileURL(join(distDir, 'host', 'index.js')).href), {
    executable: chromeExecutable,
    xvncExecutable,
    windowManagerExecutable,
    profileDir: join(workDir, 'chrome-profile'),
    userChromeDir: join(workDir, 'user-chrome'),
    dataDir: join(workDir, 'data'),
    runtimeDir: join(workDir, 'run'),
  });
  chrome = root.get('chrome');
  serveViewerHarness(root.webServer, packageJson.name, SESSION_ID);
  viewer = await openHeadlessTab(join(workDir, 'viewer'), `${host.origin}${HARNESS_PATH}/`);
});

after(async () => {
  await viewer?.close();
  await host?.dispose();
  await new Promise<void>((resolve) =>
    pageServer ? pageServer.close(() => resolve()) : resolve(),
  );
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

test("the tab starts Chrome and shows its screen, laid out at the tab's size", {
  skip,
}, async () => {
  const tab = requireViewer();
  await waitFor(() => requireChrome().state.kind === 'running', 45_000, 'Chrome to start');
  await waitFor(() => canvasShowsTheScreen(tab), 20_000, 'the screen in the tab');
  // The screen has the tab's area in device pixels, at Chrome's two pixels per CSS pixel.
  await waitFor(
    async () => {
      const { canvas, area } = await screenGeometry(tab);
      return (
        canvas.width === Math.round(area.width * 2) && canvas.height === Math.round(area.height * 2)
      );
    },
    10_000,
    "the screen to take the tab's size",
  );
});

test('keys typed in the tab go to Chrome, which opens the page the user types', {
  skip,
}, async () => {
  const tab = requireViewer();
  await focusInput(tab);
  // Ctrl+L, the address, Enter: as on a keyboard at the computer.
  await tab.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 17,
    modifiers: 2,
  });
  await tab.send('Input.dispatchKeyEvent', {
    type: 'rawKeyDown',
    key: 'l',
    code: 'KeyL',
    windowsVirtualKeyCode: 76,
    modifiers: 2,
  });
  await tab.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'l', code: 'KeyL', modifiers: 2 });
  await tab.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 17,
  });
  await tab.send('Input.insertText', { text: pageUrl });
  await tab.pressKey('Enter', 'Enter', 13);
  await waitFor(
    async () => (await pageInFront())?.url === pageUrl,
    15_000,
    'the typed address to open',
  );
  const page = await requirePageInFront();
  await waitFor(
    async () => (await evaluate<string>(page, 'document.readyState')) === 'complete',
    10_000,
    'the page to load',
  );
  assert.equal(await evaluate<string>(page, 'document.title'), TEST_PAGE_TITLE);
  // The user opened it in Chrome: no session's, and any session may use it.
  assert.equal(page.sessionId, undefined);
});

test('clicks, text, composed text and keys from the tab reach the page', { skip }, async () => {
  const tab = requireViewer();
  const page = await requirePageInFront();
  await clickInPage(tab, page, 'field');
  await waitFor(
    async () => (await evaluate<string>(page, 'document.activeElement?.id ?? ""')) === 'field',
    10_000,
    'the field to take the focus',
  );
  await tab.send('Input.insertText', { text: 'abc' });
  await waitFor(async () => (await fieldValue(page)) === 'abc', 10_000, 'typed text');

  // An input method composes in the tab; only the finished text reaches the page, pasted.
  await tab.send('Input.imeSetComposition', {
    text: 'にほんご',
    selectionStart: 4,
    selectionEnd: 4,
  });
  assert.equal(await fieldValue(page), 'abc');
  await tab.send('Input.insertText', { text: '日本語' });
  await waitFor(async () => (await fieldValue(page)) === 'abc日本語', 10_000, 'composed text');

  await tab.pressKey('Backspace', 'Backspace', 8);
  await waitFor(async () => (await fieldValue(page)) === 'abc日本', 10_000, 'a key press');

  await clickInPage(tab, page, 'go');
  await waitFor(
    async () =>
      (await evaluate<string>(page, "document.getElementById('go').textContent")) === 'Clicked',
    10_000,
    'the click',
  );
});

test("the agent's request for help appears in the tab and takes the user's answer", {
  skip,
}, async () => {
  const tab = requireViewer();
  const answer = requireChrome().helpRequests.ask(
    await requirePageInFront(),
    SESSION_ID,
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

test("the page's text and the screen can be added to the message", { skip }, async () => {
  const tab = requireViewer();
  await tab.evaluate(
    `document.querySelector('button[aria-label^="Add the text of the page"]').click()`,
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
  assert.equal(image.type, 'image/png');
  assert.ok(image.size > 0);
  assert.match(await tab.evaluate<string>('document.body.textContent'), /Added to your message\./);
});

function requireViewer(): HeadlessTab {
  assert.ok(viewer, 'the viewer did not start');
  return viewer;
}

function requireChrome(): ChromeService {
  assert.ok(chrome, 'the plugin did not start');
  return chrome;
}

function pageInFront(): Promise<ChromePage | undefined> {
  return requireChrome().pages.pageInFront();
}

async function requirePageInFront(): Promise<ChromePage> {
  const page = await pageInFront();
  assert.ok(page, 'Chrome shows no page');
  return page;
}

async function evaluate<T>(page: ChromePage, expression: string): Promise<T> {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
  return result.value as T;
}

function fieldValue(page: ChromePage): Promise<string> {
  return evaluate<string>(page, "document.getElementById('field').value");
}

/** Whether noVNC has drawn the screen: its canvas has a size, and its middle is not empty. */
function canvasShowsTheScreen(tab: HeadlessTab): Promise<boolean> {
  return tab.evaluate<boolean>(
    `(() => { const c = document.querySelector('canvas'); if (!c || c.width < 10) return false; return c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data[3] > 0; })()`,
  );
}

/** The screen's canvas (its size in the screen's pixels, and where it is drawn) and the tab's screen area. */
function screenGeometry(tab: HeadlessTab): Promise<{
  canvas: { width: number; height: number; left: number; top: number; cssWidth: number };
  area: { width: number; height: number };
}> {
  return tab.evaluate(`(() => {
    const c = document.querySelector('canvas');
    const r = c.getBoundingClientRect();
    const area = c.parentElement.parentElement.getBoundingClientRect();
    return {
      canvas: { width: c.width, height: c.height, left: r.left, top: r.top, cssWidth: r.width },
      area: { width: area.width, height: area.height },
    };
  })()`);
}

/** Puts the tab's keyboard focus on its input surface, as a click on the screen does. */
async function focusInput(tab: HeadlessTab): Promise<void> {
  await tab.evaluate(`document.querySelector('textarea[aria-label="Type into Chrome"]').focus()`);
}

/** Clicks the middle of an element of the page where the tab draws it. */
async function clickInPage(tab: HeadlessTab, page: ChromePage, id: string): Promise<void> {
  const onScreen = await evaluate<{ x: number; y: number }>(
    page,
    `(() => {
      const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      const top = screenY + outerHeight - innerHeight;
      return { x: (screenX + r.x + r.width / 2) * devicePixelRatio, y: (top + r.y + r.height / 2) * devicePixelRatio };
    })()`,
  );
  const { canvas } = await screenGeometry(tab);
  const scale = canvas.cssWidth / canvas.width;
  await tab.click(canvas.left + onScreen.x * scale, canvas.top + onScreen.y * scale);
}

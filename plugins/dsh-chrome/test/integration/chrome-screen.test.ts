/**
 * Chrome on its screen, as a viewer sees and works it: the built host plugin starts Chrome
 * on Xvnc under Openbox, in a temporary profile, and the test reaches the screen as a VNC
 * client, the way the sidebar's noVNC does.
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
import { OPENER_PAGE_HTML, OPENER_PAGE_PATH, TEST_PAGE_HTML } from '../support/test-page.ts';
import { VncClient } from '../support/vnc-client.ts';
import { waitFor } from '../support/wait.ts';

const SESSION_ID = 'screen-session';
const CONTROL_L = 0xffe3;
const KEY_A = 0x61;
const KEY_C = 0x63;
const KEY_T = 0x74;
const KEY_V = 0x76;
const KEY_W = 0x77;

const skip = await missingRequirements({ chrome: true });

let workDir = '';
let host: DshHost | undefined;
let chrome: ChromeService | undefined;
let pageServer: Server | undefined;
let pageUrl = '';
let screen: VncClient | undefined;

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-screen-'));
  pageServer = createServer((request, response) => {
    const body = request.url === OPENER_PAGE_PATH ? OPENER_PAGE_HTML : TEST_PAGE_HTML;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  await new Promise<void>((resolve) => pageServer?.listen(0, '127.0.0.1', resolve));
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/`;
  host = await startDshHost();
  await host.root.plugin(await import(pathToFileURL(join(distDir, 'host', 'index.js')).href), {
    executable: chromeExecutable,
    xvncExecutable,
    windowManagerExecutable,
    profileDir: join(workDir, 'chrome-profile'),
    userChromeDir: join(workDir, 'user-chrome'),
    dataDir: join(workDir, 'data'),
    runtimeDir: join(workDir, 'run'),
  });
  chrome = host.root.get('chrome');
});

after(async () => {
  screen?.close();
  await host?.dispose();
  await new Promise<void>((resolve) =>
    pageServer ? pageServer.close(() => resolve()) : resolve(),
  );
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

test('a viewer that connects starts the screen, and Chrome fills it at twice the pixels', {
  skip,
}, async () => {
  const service = requireChrome();
  screen = await VncClient.connect(await service.vncSocketPath());
  // The screen alone: Chrome starts when a tab asks for it.
  assert.equal(service.state.kind, 'stopped');
  await screen.refresh();
  assert.deepEqual([screen.width, screen.height], [1280, 800]);
  await service.chrome();
  assert.equal(service.state.kind, 'running');

  const page = await openTestPage();
  const window = await evaluate<{ width: number; height: number; dpr: number }>(
    page,
    '({ width: outerWidth, height: outerHeight, dpr: devicePixelRatio })',
  );
  assert.deepEqual(window, { width: 640, height: 400, dpr: 2 });
});

test("the screen takes the size a viewer asks, and Chrome's window follows it", {
  skip,
}, async () => {
  const service = requireChrome();
  const viewer = requireScreen();
  await service.resizeScreen({ width: 1100, height: 1400 });
  await viewer.refresh();
  assert.deepEqual([viewer.width, viewer.height], [1100, 1400]);
  const page = sessionPage();
  await waitFor(
    async () =>
      (await evaluate<string>(page, 'JSON.stringify([outerWidth, outerHeight])')) === '[550,700]',
    10_000,
    "Chrome's window to fill the screen",
  );
});

test("the viewer's clicks and keys reach the page, and its text pastes", { skip }, async () => {
  const viewer = requireScreen();
  const page = sessionPage();
  const field = await screenPoint(page, 'field');
  viewer.click(field.x, field.y);
  await waitFor(
    async () => (await evaluate<string>(page, 'document.activeElement?.id ?? ""')) === 'field',
    10_000,
    'the field to take the focus',
  );
  for (const character of 'typed') viewer.press(character.charCodeAt(0));
  await waitFor(async () => (await fieldValue(page)) === 'typed', 10_000, 'the typed text');

  viewer.paste(' and pasted');
  viewer.press(CONTROL_L, KEY_V);
  await waitFor(
    async () => (await fieldValue(page)) === 'typed and pasted',
    10_000,
    'the pasted text',
  );

  // A copy in Chrome reaches the viewer, which hands it to the user's own clipboard.
  viewer.press(CONTROL_L, KEY_A);
  viewer.press(CONTROL_L, KEY_C);
  await waitFor(
    () => viewer.clipboard.includes('typed and pasted'),
    10_000,
    "Chrome's copy at the viewer",
  );

  const button = await screenPoint(page, 'go');
  viewer.click(button.x, button.y);
  await waitFor(
    async () =>
      (await evaluate<string>(page, "document.getElementById('go').textContent")) === 'Clicked',
    10_000,
    'the click',
  );
});

test("a tab the user opens in Chrome is the user's, and no session's", { skip }, async () => {
  const service = requireChrome();
  const viewer = requireScreen();
  const before = new Set(service.pages.all().map((page) => page.id));
  viewer.press(CONTROL_L, KEY_T);
  let opened: ChromePage | undefined;
  await waitFor(
    () => {
      opened = service.pages.all().find((page) => !before.has(page.id));
      return opened !== undefined;
    },
    10_000,
    'the new tab',
  );
  assert.deepEqual([opened?.sessionId, opened?.openedBy], [undefined, 'user']);
  assert.equal(service.pages.reachableBy(SESSION_ID).includes(opened as ChromePage), true);
  viewer.press(CONTROL_L, KEY_W);
  await waitFor(() => opened?.ending !== undefined, 10_000, 'the tab to close');
});

test("a window a page opens stays above Chrome's, and its title bar closes it", {
  skip,
}, async () => {
  const service = requireChrome();
  const viewer = requireScreen();
  const openerUrl = new URL(OPENER_PAGE_PATH, pageUrl).href;
  const opener = await service.openPage(SESSION_ID, openerUrl, { openedBy: 'user' });
  await waitForLoad(opener, openerUrl);
  const button = await screenPoint(opener, 'popup');
  viewer.click(button.x, button.y);
  let popup: ChromePage | undefined;
  await waitFor(
    () => {
      popup = service.pages.all().find((page) => page.openerId === opener.id);
      return popup !== undefined;
    },
    10_000,
    'the popup',
  );
  assert.ok(popup);
  await waitForLoad(popup);
  // Its frame, in the screen's pixels: the page's top is below the title bar.
  const frame = await evaluate<{ right: number; top: number; width: number }>(
    popup,
    '({ right: (screenX + outerWidth) * devicePixelRatio, top: screenY * devicePixelRatio, width: outerWidth * devicePixelRatio })',
  );
  assert.ok(frame.width < viewer.width, 'the popup fills the screen');
  // Working in Chrome's window keeps the popup above it: its close button is still there.
  viewer.click(viewer.width - 20, viewer.height - 20);
  await new Promise((resolve) => setTimeout(resolve, 500));
  viewer.click(frame.right - 11, frame.top - 11);
  const closed = popup;
  await waitFor(() => closed.ending === 'closed', 10_000, 'the popup to close');
  await opener.close();
});

test('Chrome closed by the user starts again when needed, with its profile, on the same screen', {
  skip,
}, async () => {
  const service = requireChrome();
  const viewer = requireScreen();
  const page = sessionPage();
  await evaluate(page, "localStorage.setItem('kept', 'yes')");
  // Closing every tab closes Chrome, as the user does with the last tab's ✕.
  for (const open of service.pages.all()) await open.close();
  await waitFor(() => service.state.kind === 'stopped', 15_000, 'Chrome to exit');
  assert.equal(viewer.closed, false);

  const again = await service.openPage(SESSION_ID, pageUrl, { openedBy: 'user' });
  assert.equal(service.state.kind, 'running');
  await waitForLoad(again);
  assert.equal(await evaluate(again, "localStorage.getItem('kept')"), 'yes');
  await viewer.refresh();
  assert.deepEqual([viewer.width, viewer.height], [1100, 1400]);
});

function requireChrome(): ChromeService {
  assert.ok(chrome, 'the plugin did not start');
  return chrome;
}

function requireScreen(): VncClient {
  assert.ok(screen, 'no viewer is connected');
  return screen;
}

function sessionPage(): ChromePage {
  const page = requireChrome().pages.ofSession(SESSION_ID)[0];
  assert.ok(page, 'the session has no page');
  return page;
}

async function openTestPage(): Promise<ChromePage> {
  const page = await requireChrome().openPage(SESSION_ID, pageUrl, { openedBy: 'user' });
  await waitForLoad(page);
  return page;
}

/** Waits until the page shows the address, loaded: a new tab is about:blank at first. */
function waitForLoad(page: ChromePage, url = pageUrl): Promise<void> {
  return waitFor(
    async () =>
      (await evaluate<boolean>(
        page,
        `location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`,
      )) === true,
    10_000,
    'the page to load',
  );
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

/** Where the middle of an element of the page is on the screen, in the screen's pixels. */
async function screenPoint(page: ChromePage, id: string): Promise<{ x: number; y: number }> {
  return evaluate<{ x: number; y: number }>(
    page,
    `(() => {
      const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      const top = screenY + outerHeight - innerHeight;
      return {
        x: (screenX + r.x + r.width / 2) * devicePixelRatio,
        y: (top + r.y + r.height / 2) * devicePixelRatio,
      };
    })()`,
  );
}

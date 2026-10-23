/**
 * Chrome on its screen, as viewers of two sessions see and work it: the built host plugin
 * starts Chrome on Xvnc under Openbox, in a temporary profile, and the test reaches the
 * screen as a VNC client, the way the sidebar's noVNC does, with the keys passed through the
 * keyboard's focus as the screen bridge passes them.
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
import type { Context } from '@deepseek-ai/cordis';
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

const SESSION_A = 'screen-session-a';
const SESSION_B = 'screen-session-b';
/** A session no view shows, whose agent works in Chrome. */
const SESSION_C = 'screen-session-c';
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
/** The host row, as DSH's Loader holds it: its parsed configuration and its context. */
let hostFiber: { readonly config: unknown; readonly ctx: Context } | undefined;
/** The sessions shown, as a viewer shows them: each ends with its function. */
const shown: (() => void)[] = [];

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
  const fiber = host.root.plugin(
    await import(pathToFileURL(join(distDir, 'host', 'index.js')).href),
    {
      executable: chromeExecutable,
      xvncExecutable,
      windowManagerExecutable,
      profileDir: join(workDir, 'chrome-profile'),
      userChromeDir: join(workDir, 'user-chrome'),
      dataDir: join(workDir, 'data'),
      runtimeDir: join(workDir, 'run'),
    },
  );
  await fiber;
  hostFiber = fiber;
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

test('a session a viewer shows gets its part of the screen, and its window fills it at twice the pixels', {
  skip,
}, async () => {
  const service = requireChrome();
  shown.push(service.showSession(SESSION_A));
  screen = await VncClient.connect(await service.vncSocketPath());
  await service.screens.settled();
  // The screen alone: Chrome starts when the session opens a window.
  assert.equal(service.state.kind, 'stopped');
  assert.deepEqual(service.screens.monitorOf(SESSION_A), {
    id: 1,
    x: 0,
    y: 0,
    width: 2560,
    height: 1600,
  });
  await screen.refresh();
  assert.deepEqual([screen.width, screen.height], [2560, 1600]);

  const page = await openTestPage(SESSION_A);
  assert.equal(service.state.kind, 'running');
  const window = await evaluate<Record<string, number>>(
    page,
    '({ x: screenX, y: screenY, width: outerWidth, height: outerHeight, dpr: devicePixelRatio })',
  );
  assert.deepEqual(window, { x: 0, y: 0, width: 1280, height: 800, dpr: 2 });
});

test('by default, pages are not told that Chrome is under automated control', {
  skip,
}, async () => {
  // Google's sign-in refuses a browser that says it is ("may not be secure").
  assert.equal(await evaluate<boolean>(sessionPage(SESSION_A), 'navigator.webdriver'), false);
});

test("each session's part of the screen takes the size its viewer asks, beside the others, and its window follows", {
  skip,
}, async () => {
  const service = requireChrome();
  service.sizeSessionScreen(SESSION_A, { width: 1100, height: 1400 });
  shown.push(service.showSession(SESSION_B));
  const pageB = await openTestPage(SESSION_B);
  await service.screens.settled();
  assert.deepEqual(
    service.screens.layout.monitors.map((monitor) => [monitor.x, monitor.width, monitor.height]),
    [
      [0, 1100, 1400],
      [1100, 2560, 1600],
    ],
  );
  await waitFor(
    async () =>
      (await evaluate<string>(
        sessionPage(SESSION_A),
        'JSON.stringify([screenX, outerWidth, outerHeight])',
      )) === '[0,550,700]',
    10_000,
    "A's window to fill A's part of the screen",
  );
  await waitFor(
    async () =>
      (await evaluate<string>(pageB, 'JSON.stringify([screenX, outerWidth, outerHeight])')) ===
      '[550,1280,800]',
    10_000,
    "B's window to fill B's part of the screen",
  );
  const viewer = requireScreen();
  await viewer.refresh();
  assert.deepEqual([viewer.width, viewer.height], [3660, 1600]);
});

test("a session's pages open as tabs of its window, and a tab the user opens there is the session's", {
  skip,
}, async () => {
  const service = requireChrome();
  const viewer = requireScreen();
  const first = sessionPage(SESSION_A);
  const second = await service.openPage(SESSION_A, pageUrl, { openedBy: 'agent' });
  assert.equal(await windowOf(second), await windowOf(first));
  assert.notEqual(await windowOf(second), await windowOf(sessionPage(SESSION_B)));
  await second.close();

  // The user opens a tab in A's window, as with Ctrl+T in its view.
  const field = await screenPoint(first, 'field');
  viewer.click(field.x, field.y);
  const before = new Set(service.pages.all().map((page) => page.id));
  await service.keyboard.deliver(SESSION_A, () => viewer.press(CONTROL_L, KEY_T));
  let opened: ChromePage | undefined;
  await waitFor(
    () => {
      opened = service.pages.all().find((page) => !before.has(page.id));
      return opened?.sessionId !== undefined;
    },
    10_000,
    'the new tab, given to its session',
  );
  assert.deepEqual([opened?.sessionId, opened?.openedBy], [SESSION_A, 'user']);
  await service.keyboard.deliver(SESSION_A, () => viewer.press(CONTROL_L, KEY_W));
  await waitFor(() => opened?.ending !== undefined, 10_000, 'the tab to close');
});

test("the viewer's clicks and keys reach the page, and its text pastes", { skip }, async () => {
  const viewer = requireScreen();
  const page = sessionPage(SESSION_A);
  const field = await screenPoint(page, 'field');
  viewer.click(field.x, field.y);
  await waitFor(
    async () => (await evaluate<string>(page, 'document.activeElement?.id ?? ""')) === 'field',
    10_000,
    'the field to take the focus',
  );
  await evaluate(page, "document.getElementById('field').value = ''");
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

test("keys typed for a session reach its window, though another session's agent took the keyboard", {
  skip,
}, async () => {
  const service = requireChrome();
  const viewer = requireScreen();
  const pageA = sessionPage(SESSION_A);
  const pageB = sessionPage(SESSION_B);
  for (const page of [pageA, pageB])
    await evaluate(page, "document.getElementById('field').value = ''");
  const field = await screenPoint(pageA, 'field');
  viewer.click(field.x, field.y);
  await waitFor(
    async () => (await evaluate<boolean>(pageA, 'document.hasFocus()')) === true,
    10_000,
    "A's window to take the keyboard",
  );
  // B's agent clicks in its page, as chrome_click does: Chrome gives B's window the keyboard.
  const target = await evaluate<{ x: number; y: number }>(
    pageB,
    "(() => { const r = document.getElementById('field').getBoundingClientRect(); return { x: r.x + 5, y: r.y + 5 }; })()",
  );
  for (const type of ['mousePressed', 'mouseReleased'] as const) {
    await pageB.send('Input.dispatchMouseEvent', {
      type,
      x: target.x,
      y: target.y,
      button: 'left',
      clickCount: 1,
    });
  }
  await waitFor(
    async () => (await evaluate<boolean>(pageB, 'document.hasFocus()')) === true,
    10_000,
    "B's window to take the keyboard",
  );
  // The user types in A's view: the screen bridge passes each key as this does.
  for (const character of 'mine') {
    await service.keyboard.deliver(SESSION_A, () => viewer.press(character.charCodeAt(0)));
  }
  await waitFor(async () => (await fieldValue(pageA)) === 'mine', 10_000, "the keys in A's field");
  assert.equal(await fieldValue(pageB), '');
});

test("a window a page opens stays above its opener's, on the session's part of the screen, and its title bar closes it", {
  skip,
}, async () => {
  const service = requireChrome();
  const viewer = requireScreen();
  const openerUrl = new URL(OPENER_PAGE_PATH, pageUrl).href;
  const opener = await service.openPage(SESSION_B, openerUrl, { openedBy: 'user' });
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
  assert.equal(popup.sessionId, SESSION_B);
  await waitForLoad(popup);
  // Its frame, in the screen's pixels: the page's top is below the title bar.
  const frame = await evaluate<{ left: number; right: number; top: number; width: number }>(
    popup,
    '({ left: screenX * devicePixelRatio, right: (screenX + outerWidth) * devicePixelRatio, top: screenY * devicePixelRatio, width: outerWidth * devicePixelRatio })',
  );
  const monitor = service.screens.monitorOf(SESSION_B);
  assert.ok(monitor);
  assert.ok(
    frame.left >= monitor.x && frame.right <= monitor.x + monitor.width,
    "the popup is on B's part",
  );
  assert.ok(frame.width < monitor.width, 'the popup fills the screen');
  // Working in the opener's window keeps the popup above it: its close button is still there.
  viewer.click(monitor.x + monitor.width - 20, monitor.height - 20);
  await new Promise((resolve) => setTimeout(resolve, 500));
  viewer.click(frame.right - 11, frame.top - 11);
  const closed = popup;
  await waitFor(() => closed.ending === 'closed', 10_000, 'the popup to close');
  await opener.close();
});

test("Chrome stays up when every window closes; a session's part of the screen goes with its last window and viewer", {
  skip,
}, async () => {
  const service = requireChrome();
  await evaluate(sessionPage(SESSION_A), "localStorage.setItem('kept', 'yes')");
  for (const open of service.pages.all()) await open.close();
  await waitFor(() => service.pages.all().length === 0, 10_000, 'the windows to close');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(service.state.kind, 'running');
  // B's viewer goes: B has neither a window nor a viewer, and its part of the screen goes.
  shown.pop()?.();
  await service.screens.settled();
  assert.deepEqual(service.screens.sessions, [SESSION_A]);

  const again = await openTestPage(SESSION_A);
  assert.equal(await evaluate(again, "localStorage.getItem('kept')"), 'yes');
});

test('a session no view shows opens its pages on the parking monitor, as its own, and takes them along once a view shows it', {
  skip,
}, async () => {
  const service = requireChrome();
  const page = await openTestPage(SESSION_C);
  // No view shows C: its window is on the parking monitor, and the page is C's.
  assert.equal(page.sessionId, SESSION_C);
  assert.equal(service.screens.monitorOf(SESSION_C), undefined);
  const parking = service.screens.parkingMonitor;
  assert.ok(parking, 'the parking monitor');
  const left = await evaluate<number>(page, 'screenX * devicePixelRatio');
  assert.ok(
    left >= parking.x && left < parking.x + parking.width,
    'the window is on the parking monitor',
  );
  // A view shows C: its window moves to C's own monitor, and the parking monitor goes.
  const hide = service.showSession(SESSION_C);
  try {
    await service.screens.settled();
    const own = service.screens.monitorOf(SESSION_C);
    assert.ok(own, "C's own monitor");
    await waitFor(
      async () => (await evaluate<number>(page, 'screenX * devicePixelRatio')) === own.x,
      10_000,
      "C's window on its own monitor",
    );
    assert.equal(service.screens.parkingMonitor, undefined);
  } finally {
    hide();
  }
  await page.close();
});

test('a change of the settings while Chrome runs says that Chrome takes it when it starts again', {
  skip,
}, async () => {
  const service = requireChrome();
  assert.ok(service.state.kind === 'running' && !service.state.settingsChanged);
  changeSetting('deviceScaleFactor', 1.5);
  assert.ok(service.state.kind === 'running' && service.state.settingsChanged);
  changeSetting('deviceScaleFactor', 2);
  assert.ok(service.state.kind === 'running' && !service.state.settingsChanged);
});

test('Chrome started again keeps the profile, and the sessions open their windows again', {
  skip,
}, async () => {
  const service = requireChrome();
  await service.restartChrome();
  assert.equal(service.state.kind, 'running');
  assert.deepEqual(service.pages.ofSession(SESSION_A), []);
  const page = await openTestPage(SESSION_A);
  assert.equal(await evaluate(page, "localStorage.getItem('kept')"), 'yes');
  const viewer = requireScreen();
  assert.equal(viewer.closed, false);
});

/**
 * Changes a setting as DSH's Loader does when the settings page writes it: in the reference
 * the row holds, through the protocol shared by every copy of the reference's library, and
 * then it tells the row which settings changed.
 */
function changeSetting(key: string, value: unknown): void {
  assert.ok(hostFiber, 'the plugin did not start');
  const reference = (hostFiber.config as Record<string, Record<symbol, (value: unknown) => void>>)[
    key
  ];
  reference?.[Symbol.for('cosmokit.volatile.write')]?.(value);
  (hostFiber.ctx as unknown as { emit(name: string, ...args: unknown[]): void }).emit(
    'loader/volatile-update',
    [[key]],
  );
}

function requireChrome(): ChromeService {
  assert.ok(chrome, 'the plugin did not start');
  return chrome;
}

function requireScreen(): VncClient {
  assert.ok(screen, 'no viewer is connected');
  return screen;
}

function sessionPage(sessionId: string): ChromePage {
  const page = requireChrome().pages.ofSession(sessionId)[0];
  assert.ok(page, 'the session has no page');
  return page;
}

async function openTestPage(sessionId: string): Promise<ChromePage> {
  const page = await requireChrome().openPage(sessionId, pageUrl, { openedBy: 'user' });
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

/** The Chrome window the page is in. */
async function windowOf(page: ChromePage): Promise<number> {
  const chrome = await requireChrome().chrome();
  const { windowId } = await chrome.connection.send('Browser.getWindowForTarget', {
    targetId: page.targetId,
  });
  return windowId;
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

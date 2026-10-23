/**
 * The whole path a user takes: the built browser module, with noVNC, in a headless Chrome
 * standing in for DSH's web client, through DSH's web server and connection service, to
 * Chrome on its screen.
 *
 * Needs a build (`pnpm build`), Google Chrome (or DSH_CHROME_TEST_EXECUTABLE), Xvnc and
 * Openbox.
 */
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
import {
  HARNESS_PATH,
  readSettingsFixture,
  type SettingsFixture,
  serveViewerHarness,
} from '../support/viewer-harness.ts';
import { waitFor } from '../support/wait.ts';

const SESSION_ID = 'e2e-session';
const OTHER_SESSION_ID = 'e2e-other-session';

const skip = await missingRequirements({ chrome: true });

let workDir = '';
let host: DshHost | undefined;
let chrome: ChromeService | undefined;
let viewer: HeadlessTab | undefined;
/** The tab of another session, open from the two-sessions tests on. */
let otherViewer: HeadlessTab | undefined;
let settingsViewer: HeadlessTab | undefined;
let settingsFixture: SettingsFixture | undefined;
let pageServer: Server | undefined;
let pageUrl = '';

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-e2e-'));
  pageServer = createServer((request, response) => {
    // Pages that tell the sessions' windows apart at a glance, with a field to type into.
    const colour = COLOURED_PAGES[request.url ?? ''];
    const html = colour === undefined ? TEST_PAGE_HTML : colouredPage(colour);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  await new Promise<void>((resolve) => pageServer?.listen(0, '127.0.0.1', resolve));
  pageUrl = `http://127.0.0.1:${(pageServer.address() as AddressInfo).port}/`;
  // A user's Chrome with one profile, as its Local State lists it.
  await mkdir(join(workDir, 'user-chrome', 'Default'), { recursive: true });
  await writeFile(
    join(workDir, 'user-chrome', 'Local State'),
    JSON.stringify({
      profile: { info_cache: { Default: { name: 'Person 1', user_name: 'a@example.com' } } },
    }),
  );
  settingsFixture = await readSettingsFixture();
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
  serveViewerHarness(root.webServer, packageJson.name, SESSION_ID, settingsFixture);
  viewer = await openHeadlessTab(join(workDir, 'viewer'), `${host.origin}${HARNESS_PATH}/`);
});

after(async () => {
  await viewer?.close();
  await otherViewer?.close();
  await settingsViewer?.close();
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

test("the tab starts Chrome, opens the session's window and shows its part of the screen", {
  skip,
}, async () => {
  const tab = requireViewer();
  await waitFor(() => requireChrome().state.kind === 'running', 45_000, 'Chrome to start');
  await waitFor(
    async () => (await pageInFront(SESSION_ID)) !== undefined,
    20_000,
    "the session's window",
  );
  await waitFor(() => canvasShowsTheScreen(tab), 20_000, 'the screen in the tab');
  // The canvas shows the session's part only, which has the tab's area in device pixels, at
  // Chrome's two pixels per CSS pixel: not the whole screen, whatever other sessions add to it.
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
  const monitor = monitorOf(SESSION_ID);
  const { canvas } = await screenGeometry(tab);
  assert.deepEqual([canvas.width, canvas.height], [monitor.width, monitor.height]);
  assert.equal(await tab.evaluate('document.body.textContent.includes("Open a window")'), false);
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
    async () => (await pageInFront(SESSION_ID))?.url === pageUrl,
    15_000,
    'the typed address to open',
  );
  const page = await requirePageInFront(SESSION_ID);
  await waitFor(
    async () => (await evaluate<string>(page, 'document.readyState')) === 'complete',
    10_000,
    'the page to load',
  );
  assert.equal(await evaluate<string>(page, 'document.title'), TEST_PAGE_TITLE);
  // The user opened it in the session's window, so it is the session's.
  assert.equal(page.sessionId, SESSION_ID);
});

test('clicks, text, composed text and keys from the tab reach the page', { skip }, async () => {
  const tab = requireViewer();
  const page = await requirePageInFront(SESSION_ID);
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
    await requirePageInFront(SESSION_ID),
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

test("another session's tab shows that session's window, beside the first", { skip }, async () => {
  const tab = requireViewer();
  otherViewer = await openHeadlessTab(
    join(workDir, 'viewer-other'),
    `${requireHost().origin}${HARNESS_PATH}/?session=${OTHER_SESSION_ID}`,
  );
  const other = otherViewer;
  await waitFor(
    async () => (await pageInFront(OTHER_SESSION_ID)) !== undefined,
    30_000,
    "the other session's window",
  );
  await waitFor(() => canvasShowsTheScreen(other), 20_000, "the other session's screen");

  const red = await requireChrome().openPage(SESSION_ID, `${pageUrl}red`, { openedBy: 'user' });
  const blue = await requireChrome().openPage(OTHER_SESSION_ID, `${pageUrl}blue`, {
    openedBy: 'user',
  });
  // Each tab shows its own session's page, though both windows are on the one screen.
  await waitForMiddleColour(tab, [255, 0, 0], "the first session's red page in its tab");
  await waitForMiddleColour(other, [0, 0, 255], "the second session's blue page in its tab");
  assert.equal(red.sessionId, SESSION_ID);
  assert.equal(blue.sessionId, OTHER_SESSION_ID);

  // The windows are on different monitors: side by side, not over one another.
  const redX = await evaluate<number>(red, 'screenX');
  const blueX = await evaluate<number>(blue, 'screenX');
  assert.notEqual(redX, blueX);
  assert.notEqual(monitorOf(SESSION_ID).x, monitorOf(OTHER_SESSION_ID).x);
});

test("keys typed in each tab reach its own session's page, whichever window had the focus", {
  skip,
}, async () => {
  const tab = requireViewer();
  const other = requireOtherViewer();
  const pageA = await requirePageInFront(SESSION_ID);
  const pageB = await requirePageInFront(OTHER_SESSION_ID);

  await clickInPage(tab, pageA, 'field', SESSION_ID);
  await waitFor(async () => (await focusedId(pageA)) === 'field', 10_000, "A's field focus");
  await tab.send('Input.insertText', { text: 'aaa' });
  await waitFor(async () => (await fieldValue(pageA)) === 'aaa', 10_000, 'text typed in A');

  // B's window takes the focus of the screen from A's; its keys go to B.
  await clickInPage(other, pageB, 'field', OTHER_SESSION_ID);
  await waitFor(async () => (await focusedId(pageB)) === 'field', 10_000, "B's field focus");
  await other.send('Input.insertText', { text: 'bbb' });
  await waitFor(async () => (await fieldValue(pageB)) === 'bbb', 10_000, 'text typed in B');

  // A's tab types again without a click, though B's window has the focus now.
  await tab.send('Input.insertText', { text: 'ccc' });
  await waitFor(
    async () => (await fieldValue(pageA)) === 'aaaccc',
    10_000,
    'text typed in A again',
  );
  assert.equal(await fieldValue(pageB), 'bbb');
});

test("keys typed in a tab still reach its page after the agent worked in another session's page", {
  skip,
}, async () => {
  const tab = requireViewer();
  const pageA = await requirePageInFront(SESSION_ID);
  const pageB = await requirePageInFront(OTHER_SESSION_ID);

  // The agent clicks in B through CDP, which gives B's window the keyboard focus.
  const point = await evaluate<{ x: number; y: number }>(
    pageB,
    `(() => { const r = document.getElementById('field').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  const base = { ...point, button: 'left' as const, clickCount: 1 };
  await pageB.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 });
  await pageB.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });

  await tab.send('Input.insertText', { text: 'ddd' });
  await waitFor(
    async () => (await fieldValue(pageA)) === 'aaacccddd',
    10_000,
    "text typed in A after the agent's click in B",
  );
  assert.equal(await fieldValue(pageB), 'bbb');
});

test('the settings page shows the settings a running plugin may change, with their descriptions', {
  skip,
}, async () => {
  settingsViewer = await openHeadlessTab(
    join(workDir, 'viewer-settings'),
    `${requireHost().origin}${HARNESS_PATH}/?page=settings`,
  );
  const page = settingsViewer;
  await waitFor(
    async () =>
      page.evaluate<boolean>(
        `document.querySelector('label[for^="dsh-chrome-setting-"]') !== null`,
      ),
    15_000,
    'the settings form',
  );
  assert.deepEqual(
    await page.evaluate<string[]>(
      `[...document.querySelectorAll('label[for^="dsh-chrome-setting-"]')].map((l) => l.textContent)`,
    ),
    SETTING_KEYS,
  );
  // The descriptions are the schema's own.
  const text = await page.evaluate<string>('document.body.textContent');
  const { schema } = requireSettingsFixture() as {
    schema: {
      uid: unknown;
      refs: Record<string, { dict?: Record<string, unknown>; meta?: { description?: unknown } }>;
    };
  };
  const dict = schema.refs[String(schema.uid)]?.dict ?? {};
  assert.deepEqual(Object.keys(dict), SETTING_KEYS);
  for (const [key, uid] of Object.entries(dict)) {
    const description = schema.refs[String(uid)]?.meta?.description;
    assert.equal(typeof description, 'string', `the schema describes ${key}`);
    assert.ok(text.includes(description as string), `the page shows the description of ${key}`);
  }
});

test('ticking a setting asks DSH to set it at the form revision it read', { skip }, async () => {
  const page = requireSettingsViewer();
  await page.evaluate(`document.getElementById('dsh-chrome-setting-announceAutomation').click()`);
  await waitFor(
    async () => (await page.evaluate<number>('window.__mutations.length')) === 1,
    10_000,
    'the edit',
  );
  assert.deepEqual(await page.evaluate('window.__mutations'), [
    { operations: [{ op: 'set', path: ['announceAutomation'], value: true }], revision: 1 },
  ]);
});

test('the WebGL setting offers gpu, gpu-or-cpu and off', { skip }, async () => {
  const page = requireSettingsViewer();
  assert.deepEqual(
    await page.evaluate<string[]>(
      `[...document.querySelectorAll('input[type="radio"][name="dsh-chrome-setting-webgl"]')].map((r) => r.parentElement.querySelector('code').textContent)`,
    ),
    ['gpu', 'gpu-or-cpu', 'off'],
  );
});

test('the settings page lists the profiles of the Chrome of the user and asks before copying one', {
  skip,
}, async () => {
  const page = requireSettingsViewer();
  await waitFor(
    async () =>
      page.evaluate<boolean>(
        `document.querySelector('select[aria-label="Profile to copy"]') !== null`,
      ),
    10_000,
    "the user's profiles",
  );
  assert.deepEqual(
    await page.evaluate<string[]>(
      `[...document.querySelectorAll('select[aria-label="Profile to copy"] option')].map((o) => o.textContent)`,
    ),
    ['Person 1 (a@example.com)'],
  );
  await clickButton(page, 'Copy…');
  await waitFor(
    async () => page.evaluate<boolean>(`document.querySelector('[role="alertdialog"]') !== null`),
    5_000,
    'the confirmation',
  );
  assert.match(
    await page.evaluate<string>(`document.querySelector('[role="alertdialog"]').textContent`),
    /Replace dsh-chrome's profile with a copy of “Person 1”\?/,
  );
  // Nothing is copied until the user confirms.
  assert.equal(await exists(join(workDir, 'chrome-profile', 'Default.before-copy')), false);
  await clickButton(page, 'Cancel');
  assert.equal(
    await page.evaluate('document.querySelector(\'[role="alertdialog"]\') === null'),
    true,
  );
  assert.equal(await exists(join(workDir, 'chrome-profile', 'Default.before-copy')), false);
});

test("a confirmed copy replaces dsh-chrome's profile and keeps the one it replaced", {
  skip,
}, async () => {
  const page = requireSettingsViewer();
  await clickButton(page, 'Copy…');
  await page.evaluate(
    `[...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === 'Copy').click()`,
  );
  await waitFor(
    async () =>
      page.evaluate<boolean>(
        `(document.querySelector('[role="status"]')?.textContent ?? '').includes('is now a copy of')`,
      ),
    60_000,
    'the copy',
  );
  assert.equal(await exists(join(workDir, 'chrome-profile', 'Default.before-copy')), true);
});

/** The settings the page shows: those a running plugin may change. */
const SETTING_KEYS = [
  'executable',
  'deviceScaleFactor',
  'announceAutomation',
  'webgl',
  'shareNativeHosts',
];

const COLOURED_PAGES: Record<string, string> = { '/red': '#ff0000', '/blue': '#0000ff' };

function colouredPage(colour: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${colour}</title>
<body style="margin:0;background:${colour}">
<input id="field" aria-label="Field" style="position:absolute;left:20px;top:20px;width:200px;height:30px"></body>`;
}

function requireHost(): DshHost {
  assert.ok(host, 'the host did not start');
  return host;
}

function requireSettingsFixture(): SettingsFixture {
  assert.ok(settingsFixture, 'the settings fixture was not read');
  return settingsFixture;
}

function focusedId(page: ChromePage): Promise<string> {
  return evaluate<string>(page, 'document.activeElement?.id ?? ""');
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** Clicks the page's button with this label. */
function clickButton(page: HeadlessTab, label: string): Promise<void> {
  return page.evaluate(
    `[...document.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(label)}).click()`,
  );
}

function requireOtherViewer(): HeadlessTab {
  assert.ok(otherViewer, 'the second tab did not start');
  return otherViewer;
}

function requireSettingsViewer(): HeadlessTab {
  assert.ok(settingsViewer, 'the settings page did not start');
  return settingsViewer;
}

function requireViewer(): HeadlessTab {
  assert.ok(viewer, 'the viewer did not start');
  return viewer;
}

function requireChrome(): ChromeService {
  assert.ok(chrome, 'the plugin did not start');
  return chrome;
}

function pageInFront(sessionId: string): Promise<ChromePage | undefined> {
  return requireChrome().pages.pageInFront(sessionId);
}

async function requirePageInFront(sessionId: string): Promise<ChromePage> {
  const page = await pageInFront(sessionId);
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

/** The session's part of the screen, as applied: where its windows are, in device pixels. */
function monitorOf(sessionId: string): { x: number; y: number; width: number; height: number } {
  const monitor = requireChrome().screens.monitorOf(sessionId);
  assert.ok(monitor, `session ${sessionId} has no part of the screen`);
  return monitor;
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

/** The colour of the pixel in the middle of the tab's screen canvas. */
function middlePixel(tab: HeadlessTab): Promise<number[]> {
  return tab.evaluate<number[]>(
    `(() => { const c = document.querySelector('canvas'); return Array.from(c.getContext('2d').getImageData(c.width >> 1, c.height >> 1, 1, 1).data); })()`,
  );
}

/** Waits until the middle of the tab's screen is the colour, within what the stream's compression costs. */
function waitForMiddleColour(tab: HeadlessTab, [red, green, blue]: number[], what: string) {
  return waitFor(
    async () => {
      const [r = 0, g = 0, b = 0] = await middlePixel(tab);
      return (
        Math.abs(r - (red ?? 0)) < 40 &&
        Math.abs(g - (green ?? 0)) < 40 &&
        Math.abs(b - (blue ?? 0)) < 40
      );
    },
    20_000,
    what,
  );
}

/** Puts the tab's keyboard focus on its input surface, as a click on the screen does. */
async function focusInput(tab: HeadlessTab): Promise<void> {
  await tab.evaluate(`document.querySelector('textarea[aria-label="Type into Chrome"]').focus()`);
}

/** Clicks the middle of an element of the page where the tab draws it. */
async function clickInPage(
  tab: HeadlessTab,
  page: ChromePage,
  id: string,
  sessionId = SESSION_ID,
): Promise<void> {
  const onScreen = await evaluate<{ x: number; y: number }>(
    page,
    `(() => {
      const r = document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
      const top = screenY + outerHeight - innerHeight;
      return { x: (screenX + r.x + r.width / 2) * devicePixelRatio, y: (top + r.y + r.height / 2) * devicePixelRatio };
    })()`,
  );
  // The tab draws its session's part only: points are relative to its origin on the screen.
  const origin = monitorOf(sessionId);
  const { canvas } = await screenGeometry(tab);
  const scale = canvas.cssWidth / canvas.width;
  await tab.click(
    canvas.left + (onScreen.x - origin.x) * scale,
    canvas.top + (onScreen.y - origin.y) * scale,
  );
}

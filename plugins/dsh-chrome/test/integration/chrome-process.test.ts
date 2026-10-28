/**
 * Chrome as dsh-chrome starts it, on a screen of its own, as pages see it.
 *
 * Needs Google Chrome (or DSH_CHROME_TEST_EXECUTABLE), Xvnc and Openbox.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { type Display, startDisplay } from '../../src/host/chrome/display/display.ts';
import { PageRegistry } from '../../src/host/chrome/pages/page-registry.ts';
import {
  type ChromeProcess,
  launchChrome,
  type WebglMode,
} from '../../src/host/chrome/process/launch.ts';
import { silentLog } from '../../src/host/platform/log.ts';
import {
  chromeExecutable,
  missingRequirements,
  windowManagerExecutable,
  xvncExecutable,
} from '../support/environment.ts';

const skip = await missingRequirements({ chrome: true });

let workDir = '';
let display: Display | undefined;

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-process-'));
  display = await startDisplay({
    xvnc: xvncExecutable,
    windowManager: windowManagerExecutable,
    runtimeDir: join(workDir, 'run'),
    size: { width: 1024, height: 768 },
  });
});

after(async () => {
  await display?.stop();
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

let profiles = 0;

/** Starts Chrome so, on a profile of its own, and evaluates the expression in a new page. */
async function evaluateInChrome(
  options: { readonly announceAutomation?: boolean; readonly webgl?: WebglMode },
  expression: string,
  before?: (chrome: ChromeProcess, pages: PageRegistry) => Promise<void>,
): Promise<unknown> {
  assert.ok(display, 'the screen did not start');
  profiles += 1;
  const chrome = await launchChrome({
    executable: chromeExecutable,
    profileDir: join(workDir, `profile-${profiles}`),
    display: display.name,
    authorityPath: display.authorityPath,
    deviceScaleFactor: 1,
    announceAutomation: options.announceAutomation ?? false,
    webgl: options.webgl ?? 'off',
    log: silentLog,
  });
  try {
    const pages = new PageRegistry();
    await pages.track(chrome.connection);
    await before?.(chrome, pages);
    const { targetId } = await chrome.connection.send('Target.createTarget', {
      url: 'about:blank',
      newWindow: true,
    });
    const page = await pages.whenAdopted(targetId);
    const { result } = await page.send('Runtime.evaluate', { expression, returnByValue: true });
    return result.value;
  } finally {
    await chrome.close();
  }
}

/** The renderer WebGL draws with in a page, or null without WebGL. */
const WEBGL_RENDERER = `(() => {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (gl === null) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info === null ? 'unknown' : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
})()`;

test('Chrome starts with no window of its own: each session opens its own', {
  skip,
}, async () => {
  await evaluateInChrome({}, '1', async (_chrome, pages) => {
    // Give a startup window time to show up, were there one.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.deepEqual(pages.all(), []);
  });
});

test('pages get WebGL, which Chrome otherwise turns off on a screen without a GPU', {
  skip,
}, async () => {
  assert.equal(await evaluateInChrome({ webgl: 'off' }, WEBGL_RENDERER), null);
  // On the GPU where Vulkan reaches one, else on the CPU: either way through ANGLE.
  const renderer = await evaluateInChrome({ webgl: 'gpu-or-cpu' }, WEBGL_RENDERER);
  assert.equal(typeof renderer, 'string');
  assert.match(renderer as string, /^ANGLE \(/);
});

test('pages are not told that Chrome is under automated control, unless they are to be', {
  skip,
}, async () => {
  // Chrome would tell them, for the pipe it is controlled through; Google's sign-in then
  // refuses the browser as one that "may not be secure".
  const webdriver = (announceAutomation: boolean) =>
    evaluateInChrome({ announceAutomation }, 'navigator.webdriver');
  assert.equal(await webdriver(false), false);
  assert.equal(await webdriver(true), true);
});

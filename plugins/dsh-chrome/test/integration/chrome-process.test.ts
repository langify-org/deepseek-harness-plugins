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
import { launchChrome } from '../../src/host/chrome/process/launch.ts';
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

/** What `navigator.webdriver` says in a page of Chrome started so. */
async function webdriverFlag(announceAutomation: boolean): Promise<unknown> {
  assert.ok(display, 'the screen did not start');
  const chrome = await launchChrome({
    executable: chromeExecutable,
    profileDir: join(workDir, `profile-${announceAutomation}`),
    display: display.name,
    authorityPath: display.authorityPath,
    deviceScaleFactor: 1,
    announceAutomation,
    log: silentLog,
  });
  try {
    const pages = new PageRegistry();
    await pages.track(chrome.connection);
    const { targetId } = await chrome.connection.send('Target.createTarget', {
      url: 'about:blank',
    });
    const page = await pages.whenAdopted(targetId);
    const { result } = await page.send('Runtime.evaluate', {
      expression: 'navigator.webdriver',
      returnByValue: true,
    });
    return result.value;
  } finally {
    await chrome.close();
  }
}

test('pages are not told that Chrome is under automated control, unless they are to be', {
  skip,
}, async () => {
  // Chrome would tell them, for the pipe it is controlled through; Google's sign-in then
  // refuses the browser as one that "may not be secure".
  assert.equal(await webdriverFlag(false), false);
  assert.equal(await webdriverFlag(true), true);
});

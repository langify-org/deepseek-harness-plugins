import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromeArguments } from '../../../../../src/host/chrome/process/launch.ts';

const options = {
  profileDir: '/home/someone/.dsh/dsh-chrome/chrome-profile',
  deviceScaleFactor: 2,
};

test('starts Chrome on its profile, controlled through the pipe, at the scale factor', () => {
  const args = chromeArguments({ ...options, announceAutomation: false });
  assert.deepEqual(args.slice(0, 6), [
    '--user-data-dir=/home/someone/.dsh/dsh-chrome/chrome-profile',
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--ozone-platform=x11',
    '--force-device-scale-factor=2',
  ]);
  // No debugging port: whoever reached it would control Chrome.
  assert.equal(
    args.some((arg) => arg.startsWith('--remote-debugging-port')),
    false,
  );
});

test('turns off what tells pages Chrome is automated, unless they are to be told', () => {
  assert.equal(
    chromeArguments({ ...options, announceAutomation: false }).at(-1),
    '--disable-blink-features=AutomationControlled',
  );
  assert.equal(
    chromeArguments({ ...options, announceAutomation: true }).some((arg) =>
      arg.includes('AutomationControlled'),
    ),
    false,
  );
});

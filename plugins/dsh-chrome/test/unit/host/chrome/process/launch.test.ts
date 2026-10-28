import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromeArguments, WEBGL_MODES } from '../../../../../src/host/chrome/process/launch.ts';

const options = {
  profileDir: '/home/someone/.dsh/dsh-chrome/chrome-profile',
  deviceScaleFactor: 2,
  webgl: 'gpu' as const,
};

test('starts Chrome on its profile, controlled through the pipe, at the scale factor', () => {
  const args = chromeArguments({ ...options, announceAutomation: false });
  assert.deepEqual(args.slice(0, 7), [
    '--user-data-dir=/home/someone/.dsh/dsh-chrome/chrome-profile',
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-startup-window',
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
    chromeArguments({ ...options, announceAutomation: false }).includes(
      '--disable-blink-features=AutomationControlled',
    ),
    true,
  );
  assert.equal(
    chromeArguments({ ...options, announceAutomation: true }).some((arg) =>
      arg.includes('AutomationControlled'),
    ),
    false,
  );
});

test('opens no window by itself, since each session opens its own', () => {
  assert.equal(
    chromeArguments({ ...options, announceAutomation: false }).includes('--no-startup-window'),
    true,
  );
});

test('gives each WebGL mode its arguments, compositing on the CPU whenever WebGL may use the GPU', () => {
  const expected = {
    // Compositing on the GPU would read every frame back from it for the screen.
    gpu: ['--use-angle=vulkan', '--disable-gpu-compositing'],
    'gpu-or-cpu': ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--disable-gpu-compositing'],
    off: [],
  };
  assert.deepEqual([...WEBGL_MODES].sort(), Object.keys(expected).sort());
  for (const webgl of WEBGL_MODES) {
    const args = chromeArguments({ ...options, announceAutomation: true, webgl });
    assert.deepEqual(
      args.filter((arg) => arg.includes('angle') || arg.includes('gpu')),
      expected[webgl],
    );
  }
});

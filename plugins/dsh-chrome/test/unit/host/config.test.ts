import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Config } from '../../../src/host/index.ts';

test("by default, runs Chrome on Xvnc under Openbox, at the display's pixel ratio, in the DSH home", () => {
  // What DSH passes when the user sets nothing.
  const config = Config({});
  const home = process.env['DSH_HOME'] ?? '';
  assert.deepEqual(
    {
      executable: config.executable.get(),
      xvncExecutable: config.xvncExecutable,
      windowManagerExecutable: config.windowManagerExecutable,
      deviceScaleFactor: config.deviceScaleFactor.get(),
      webgl: config.webgl.get(),
      shareNativeHosts: config.shareNativeHosts.get(),
      profileDir: config.profileDir,
      dataDir: config.dataDir,
    },
    {
      executable: 'google-chrome-stable',
      xvncExecutable: 'Xvnc',
      windowManagerExecutable: 'openbox',
      deviceScaleFactor: 'auto',
      webgl: 'gpu',
      shareNativeHosts: true,
      profileDir: join(home, 'dsh-chrome', 'chrome-profile'),
      dataDir: join(home, 'dsh-chrome'),
    },
  );
});

test('by default, does not tell pages that Chrome is under automated control', () => {
  assert.equal(Config({}).announceAutomation.get(), false);
});

test('lets the user change exactly the settings that take effect without a restart of DSH', () => {
  // The paths and the X programs are fixed for the Host's life; the rest the user may change.
  const schema = Config.toJSON() as unknown as {
    refs: Record<
      string,
      { type: string; dict?: Record<string, number>; meta?: { volatile?: boolean } }
    >;
    uid: number;
  };
  const properties = schema.refs[schema.uid]?.dict ?? {};
  const volatile = Object.entries(properties)
    .filter(([, id]) => schema.refs[id]?.meta?.volatile === true)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(volatile, [
    'announceAutomation',
    'deviceScaleFactor',
    'executable',
    'shareNativeHosts',
    'webgl',
  ]);
});

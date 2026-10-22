import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { Config } from '../../../src/host/index.ts';

test('by default, runs Chrome on Xvnc under Openbox, at twice the pixels, in the DSH home', () => {
  // What DSH passes when the user sets nothing; the schema's type names only what it returns.
  const config = Config({} as Config);
  const home = process.env['DSH_HOME'] ?? '';
  assert.deepEqual(
    {
      executable: config.executable,
      xvncExecutable: config.xvncExecutable,
      windowManagerExecutable: config.windowManagerExecutable,
      deviceScaleFactor: config.deviceScaleFactor,
      shareNativeHosts: config.shareNativeHosts,
      profileDir: config.profileDir,
      dataDir: config.dataDir,
    },
    {
      executable: 'google-chrome-stable',
      xvncExecutable: 'Xvnc',
      windowManagerExecutable: 'openbox',
      deviceScaleFactor: 2,
      shareNativeHosts: true,
      profileDir: join(home, 'dsh-chrome', 'chrome-profile'),
      dataDir: join(home, 'dsh-chrome'),
    },
  );
});

test('by default, does not tell pages that Chrome is under automated control', () => {
  assert.equal(Config({} as Config).announceAutomation, false);
});

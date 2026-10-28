import assert from 'node:assert/strict';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  defaultDataDir,
  defaultProfileDir,
  defaultRuntimeDir,
  defaultUserChromeDir,
  earlierProfileDirs,
} from '../../../../src/host/platform/locations.ts';

/** Sets environment variables for one test. */
function withEnv(t: TestContext, values: Readonly<Record<string, string>>): void {
  const previous = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test('keeps its profile and records in the DSH home, and knows where 0.2 kept the profile', (t) => {
  withEnv(t, { DSH_HOME: '/srv/dsh-home' });
  assert.equal(defaultDataDir(), join('/srv/dsh-home', 'dsh-chrome'));
  assert.equal(defaultProfileDir(), join('/srv/dsh-home', 'dsh-chrome', 'chrome-profile'));
  assert.deepEqual(earlierProfileDirs(), [
    join('/srv/dsh-home', 'dsh-chrome', 'profiles', 'dedicated'),
  ]);
});

test('gives each DSH home a runtime directory of its own, for its screen', (t) => {
  withEnv(t, { XDG_RUNTIME_DIR: '/run/user/1000', DSH_HOME: '/srv/a' });
  const first = defaultRuntimeDir();
  withEnv(t, { DSH_HOME: '/srv/b' });
  const second = defaultRuntimeDir();
  assert.match(first, /^\/run\/user\/1000\/dsh-chrome\/[0-9a-f]{12}$/);
  assert.notEqual(first, second);
  withEnv(t, { DSH_HOME: '/srv/a' });
  assert.equal(defaultRuntimeDir(), first);
});

test("finds the user's own Chrome where Chrome keeps it on Linux", (t) => {
  withEnv(t, { XDG_CONFIG_HOME: '/home/someone/.config' });
  if (process.platform !== 'darwin') {
    assert.equal(defaultUserChromeDir(), join('/home/someone/.config', 'google-chrome'));
  }
});

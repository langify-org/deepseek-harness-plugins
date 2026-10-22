import assert from 'node:assert/strict';
import { join } from 'node:path';
import { type TestContext, test } from 'node:test';
import {
  defaultConnectorSocketPath,
  defaultDataDir,
  defaultDedicatedUserDataDir,
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

test('keeps its files in the DSH home', (t) => {
  withEnv(t, { DSH_HOME: '/srv/dsh-home' });
  assert.equal(defaultDataDir(), join('/srv/dsh-home', 'dsh-chrome'));
  assert.equal(
    defaultDedicatedUserDataDir(),
    join('/srv/dsh-home', 'dsh-chrome', 'profiles', 'dedicated'),
  );
});

test('gives each DSH home a connector socket of its own in the runtime directory', (t) => {
  withEnv(t, { XDG_RUNTIME_DIR: '/run/user/1000', DSH_HOME: '/srv/a' });
  const first = defaultConnectorSocketPath();
  withEnv(t, { DSH_HOME: '/srv/b' });
  const second = defaultConnectorSocketPath();
  assert.match(first, /^\/run\/user\/1000\/dsh-chrome\/[0-9a-f]{12}\.sock$/);
  assert.notEqual(first, second);
  withEnv(t, { DSH_HOME: '/srv/a' });
  assert.equal(defaultConnectorSocketPath(), first);
});

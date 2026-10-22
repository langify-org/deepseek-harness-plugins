import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { launchDedicatedChrome } from '../../../../../src/host/chrome/dedicated-chrome/launch.ts';
import { silentLog } from '../../../../../src/host/platform/log.ts';

test('rejects with the executable named when Chrome cannot be started', async (t) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-test-profile-'));
  const extensionDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-test-extension-'));
  t.after(async () => {
    await rm(userDataDir, { recursive: true, force: true });
    await rm(extensionDir, { recursive: true, force: true });
  });

  const executable = '/nonexistent/dsh-chrome-test-chrome';
  await assert.rejects(
    launchDedicatedChrome({
      executable,
      userDataDir,
      extensionDir,
      display: 'desktop',
      log: silentLog,
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.message.startsWith(
        `could not start the dedicated Chrome (${executable}) with the connector: `,
      ),
  );
});

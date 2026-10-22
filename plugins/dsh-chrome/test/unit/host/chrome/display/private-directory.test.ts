import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { makePrivateDirectory } from '../../../../../src/host/chrome/display/private-directory.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-private-'));
after(() => rm(scratch, { recursive: true, force: true }));

const mode = async (path: string) => (await stat(path)).mode & 0o777;

test('makes the directory and the ones above it private to the user', async () => {
  const path = join(scratch, 'made', 'run');
  await makePrivateDirectory(path);
  assert.equal(await mode(path), 0o700);
  assert.equal(await mode(join(scratch, 'made')), 0o700);
});

test('takes a directory left from before, and makes it private again', async () => {
  const path = join(scratch, 'left');
  await mkdir(path);
  await chmod(path, 0o755);
  await makePrivateDirectory(path);
  assert.equal(await mode(path), 0o700);
});

test("refuses a link in the directory's place", async () => {
  const target = join(scratch, 'elsewhere');
  await mkdir(target);
  const path = join(scratch, 'linked');
  await symlink(target, path);
  await assert.rejects(makePrivateDirectory(path), /not a directory of this user's own/);
});

test("refuses a directory in one that is not the user's own, such as /tmp", async (t) => {
  if (process.getuid === undefined || (await stat('/tmp')).uid === process.getuid()) {
    t.skip('needs a /tmp of another user');
    return;
  }
  const path = await mkdtemp('/tmp/dsh-chrome-private-');
  try {
    await assert.rejects(makePrivateDirectory(path), /\/tmp is not a directory of this user's own/);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

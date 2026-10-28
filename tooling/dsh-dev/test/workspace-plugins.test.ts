import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DshDevError } from '../src/errors.ts';
import { workspacePlugins } from '../src/workspace-plugins.ts';

const repository = await mkdtemp(join(tmpdir(), 'dsh-dev-workspace-'));
after(() => rm(repository, { recursive: true, force: true }));

async function packageAt(name: string, manifest: string): Promise<void> {
  const dir = join(repository, 'plugins', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), manifest);
}

test("lists the workspace's packages that declare themselves DSH plugins", async () => {
  await packageAt('b-plugin', JSON.stringify({ name: '@acme/b', version: '1.0.0', dsh: {} }));
  await packageAt('a-plugin', JSON.stringify({ name: '@acme/a', version: '0.2.0', dsh: {} }));
  await packageAt('library', JSON.stringify({ name: '@acme/library', version: '1.0.0' }));
  await mkdir(join(repository, 'plugins', 'no-manifest'));
  assert.deepEqual(await workspacePlugins(repository), [
    { name: '@acme/a', version: '0.2.0', dir: join(repository, 'plugins', 'a-plugin') },
    { name: '@acme/b', version: '1.0.0', dir: join(repository, 'plugins', 'b-plugin') },
  ]);
});

test('refuses a plugin manifest it cannot read', async () => {
  const broken = await mkdtemp(join(tmpdir(), 'dsh-dev-broken-'));
  try {
    await mkdir(join(broken, 'plugins', 'broken'), { recursive: true });
    await writeFile(join(broken, 'plugins', 'broken', 'package.json'), '{ not json');
    await assert.rejects(workspacePlugins(broken), DshDevError);
    await writeFile(join(broken, 'plugins', 'broken', 'package.json'), JSON.stringify({ dsh: {} }));
    await assert.rejects(workspacePlugins(broken), { message: /no package name and version/ });
  } finally {
    await rm(broken, { recursive: true, force: true });
  }
});

test('finds none in a repository without plugins', async () => {
  assert.deepEqual(await workspacePlugins(join(repository, 'nowhere')), []);
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { prunePacks, storePack } from '../src/plugin-packs.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-dev-packs-'));
after(() => rm(scratch, { recursive: true, force: true }));

const plugin = { name: '@acme/plugin', version: '0.1.0' };

async function packed(content: string): Promise<string> {
  const dir = await mkdtemp(join(scratch, 'packing-'));
  const tarball = join(dir, 'acme-plugin-0.1.0.tgz');
  await writeFile(tarball, content);
  return tarball;
}

test('names a stored pack by its content', async () => {
  const packagesDir = join(scratch, 'named');
  await mkdir(packagesDir);
  const first = await storePack(await packed('one'), packagesDir, plugin);
  const again = await storePack(await packed('one'), packagesDir, plugin);
  const changed = await storePack(await packed('two'), packagesDir, plugin);
  assert.match(first.path, /acme-plugin-0\.1\.0-[0-9a-f]{12}\.tgz$/);
  assert.equal(again.path, first.path);
  assert.notEqual(changed.path, first.path);
  assert.deepEqual({ name: first.name, version: first.version }, plugin);
});

test('prunes every pack but the ones kept', async () => {
  const packagesDir = join(scratch, 'pruned');
  await mkdir(packagesDir);
  const kept = await storePack(await packed('kept'), packagesDir, plugin);
  await storePack(await packed('old'), packagesDir, plugin);
  await mkdir(join(packagesDir, '.packing-left'));
  await prunePacks(packagesDir, new Set([kept.path]));
  assert.deepEqual(
    (await readdir(packagesDir)).sort(),
    ['.packing-left', kept.path.split('/').at(-1)].sort(),
  );
});

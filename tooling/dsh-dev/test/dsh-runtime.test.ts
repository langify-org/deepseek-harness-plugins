import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { DshRuntimeError, findDshRuntime, readDshRuntime } from '../src/dsh-runtime.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-dev-runtime-'));
after(() => rm(scratch, { recursive: true, force: true }));

/** Lays out a DSH Desktop resources directory of the version, without some parts if asked. */
async function fakeResources(
  dir: string,
  version: string,
  missing: readonly ('node' | 'pnpm' | 'cli')[] = [],
): Promise<string> {
  const files = {
    node: ['runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node'],
    pnpm: ['runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'],
    cli: ['app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'],
  } as const;
  for (const [part, path] of Object.entries(files)) {
    if (missing.includes(part as keyof typeof files)) continue;
    await mkdir(join(dir, ...path.slice(0, -1)), { recursive: true });
    await writeFile(join(dir, ...path), '');
  }
  const packageDir = join(dir, 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh');
  await mkdir(packageDir, { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: '@deepseek-ai/dsh', version, bin: { dsh: 'lib/bin.js' } }),
  );
  return dir;
}

test('reads the parts of a DSH installation from its resources directory', async () => {
  const dir = await fakeResources(join(scratch, 'complete'), '0.2.1-rc.2');
  assert.deepEqual(await readDshRuntime(dir), {
    version: '0.2.1-rc.2',
    resourcesDir: dir,
    node: join(dir, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node'),
    nodeOptions: ['--expose-internals'],
    cli: join(dir, 'app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    pnpm: join(dir, 'runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'),
  });
});

test('finds no installation where a part is missing', async () => {
  for (const part of ['node', 'pnpm', 'cli'] as const) {
    const dir = await fakeResources(join(scratch, `without-${part}`), '0.2.1-rc.2', [part]);
    assert.equal(await readDshRuntime(dir), undefined, part);
  }
  assert.equal(await readDshRuntime(join(scratch, 'nothing-here')), undefined);
});

test('uses the installation DSH_RUNTIME names, and refuses one that is not', async () => {
  const dir = await fakeResources(join(scratch, 'named'), '0.2.0');
  const runtime = await findDshRuntime({ env: { DSH_RUNTIME: dir }, nixStore: scratch });
  assert.equal(runtime.resourcesDir, dir);
  await assert.rejects(
    findDshRuntime({ env: { DSH_RUNTIME: join(scratch, 'nothing-here') }, nixStore: scratch }),
    DshRuntimeError,
  );
});

test('falls back to the DSH Desktop it runs under, then to the newest one in the Nix store', async () => {
  const store = join(scratch, 'store');
  await fakeResources(
    join(store, `${'a'.repeat(32)}-deepseek-harness-desktop-0.2.1-rc.1-extracted`, 'resources'),
    '0.2.1-rc.1',
  );
  const newest = await fakeResources(
    join(store, `${'b'.repeat(32)}-deepseek-harness-desktop-0.2.1-rc.2-extracted`, 'resources'),
    '0.2.1-rc.2',
  );
  await fakeResources(join(store, `${'c'.repeat(32)}-something-else`, 'resources'), '9.9.9');
  assert.equal((await findDshRuntime({ env: {}, nixStore: store })).resourcesDir, newest);

  const desktop = await fakeResources(join(scratch, 'desktop'), '0.2.0');
  const underDesktop = await findDshRuntime({
    env: { DSH_DESKTOP_RESOURCES_PATH: desktop },
    nixStore: store,
  });
  assert.equal(underDesktop.resourcesDir, desktop);
});

test('explains how to name an installation when it finds none', async () => {
  await assert.rejects(findDshRuntime({ env: {}, nixStore: join(scratch, 'empty-store') }), {
    name: 'DshRuntimeError',
    message: /set DSH_RUNTIME/,
  });
});

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { installedDependencies, planProfileSync } from '../src/profile-sync.ts';

const packagesDir = '/work/repo/.dsh-home/packages';
const pack = (name: string, file: string) => ({
  name,
  version: '0.1.0',
  path: join(packagesDir, file),
});

test('installs new and changed workspace plugins and keeps unchanged ones', () => {
  const sync = planProfileSync(
    {
      '@acme/kept': `file:${join(packagesDir, 'acme-kept-0.1.0-aaaa.tgz')}`,
      '@acme/changed': `file:${join(packagesDir, 'acme-changed-0.1.0-old.tgz')}`,
    },
    [
      pack('@acme/kept', 'acme-kept-0.1.0-aaaa.tgz'),
      pack('@acme/changed', 'acme-changed-0.1.0-new.tgz'),
      pack('@acme/new', 'acme-new-0.1.0-cccc.tgz'),
    ],
    packagesDir,
  );
  assert.deepEqual(sync, {
    add: [
      join(packagesDir, 'acme-changed-0.1.0-new.tgz'),
      join(packagesDir, 'acme-new-0.1.0-cccc.tgz'),
    ],
    remove: [],
  });
});

test('removes plugins that left the workspace, and leaves ones installed by hand', () => {
  const sync = planProfileSync(
    {
      '@acme/gone': `file:${join(packagesDir, 'acme-gone-0.1.0-dddd.tgz')}`,
      'dsh-extra': '^1.2.0',
      '@acme/local': 'file:/elsewhere/acme-local.tgz',
    },
    [],
    packagesDir,
  );
  assert.deepEqual(sync, { add: [], remove: ['@acme/gone'] });
});

const scratch = await mkdtemp(join(tmpdir(), 'dsh-dev-profile-'));
after(() => rm(scratch, { recursive: true, force: true }));

test("reads a profile's dependencies, and none before DSH created it", async () => {
  assert.deepEqual(await installedDependencies(join(scratch, 'missing')), {});
  const profile = join(scratch, 'web');
  await mkdir(profile);
  await writeFile(
    join(profile, 'package.json'),
    JSON.stringify({ name: 'dsh-profile-web', dependencies: { a: 'file:/x.tgz', b: 3 } }),
  );
  assert.deepEqual(await installedDependencies(profile), { a: 'file:/x.tgz' });
});

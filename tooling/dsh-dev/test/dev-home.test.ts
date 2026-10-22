import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, test } from 'node:test';
import { promisify } from 'node:util';
import { DevHome } from '../src/dev-home.ts';
import type { DshRuntime } from '../src/dsh-runtime.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-dev-home-'));
after(() => rm(scratch, { recursive: true, force: true }));

test('lives in .dsh-home at the repository root, serving the web profile', () => {
  const home = DevHome.of('/work/repo');
  assert.equal(home.root, join('/work/repo', '.dsh-home'));
  assert.equal(home.profileDir, join('/work/repo', '.dsh-home', 'profiles', 'web'));
  assert.equal(home.packagesDir, join('/work/repo', '.dsh-home', 'packages'));
});

test("runs DSH in its home, with its own bin first, without a surrounding DSH's or pnpm's variables", () => {
  const home = new DevHome('/work/repo/.dsh-home');
  const environment = home.environment({
    PATH: '/usr/bin',
    HOME: '/home/someone',
    DSH_HOME: '/home/someone/.local/share/deepseek-harness-desktop',
    DSH_WEB_URL: 'http://127.0.0.1:3080/',
    ELECTRON_RUN_AS_NODE: '1',
    npm_config_user_agent: 'pnpm/12.9.0',
    npm_lifecycle_event: 'dev',
    PNPM_SCRIPT_SRC_DIR: '/work/repo',
    INIT_CWD: '/work/repo',
  });
  assert.deepEqual(environment, {
    HOME: '/home/someone',
    DSH_HOME: '/work/repo/.dsh-home',
    PATH: ['/work/repo/.dsh-home/bin', '/usr/bin'].join(delimiter),
  });
});

test("puts DSH's own pnpm on its PATH, run by DSH's Node.js", async () => {
  const home = new DevHome(join(scratch, "it's home"));
  // A stand-in for Node.js that prints what it was asked to run.
  const node = join(scratch, 'node');
  await writeFile(node, '#!/bin/sh\necho "$@"\n');
  await chmod(node, 0o755);
  const runtime = { node, pnpm: '/opt/dsh/pnpm.cjs' } as DshRuntime;
  await home.prepare(runtime);
  const pnpm = join(home.binDir, 'pnpm');
  assert.equal((await stat(pnpm)).mode & 0o111, 0o111);
  const { stdout } = await promisify(execFile)(pnpm, ['add', 'a b']);
  assert.equal(stdout, '/opt/dsh/pnpm.cjs add a b\n');
});

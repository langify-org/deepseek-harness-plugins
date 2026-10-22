import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

/** Runs dsh-dev and returns its exit code and output. */
async function dshDev(
  ...args: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [cli, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

test('explains itself when asked or given nothing to do', async () => {
  for (const args of [[], ['--help']]) {
    const { code, stdout } = await dshDev(...args);
    assert.equal(code, 0);
    assert.match(stdout, /^Usage: dsh-dev <command>/);
  }
});

test('refuses a command it does not know, with its usage', async () => {
  const { code, stderr } = await dshDev('launch');
  assert.equal(code, 2);
  assert.match(stderr, /unknown command launch/);
  assert.match(stderr, /Usage: dsh-dev/);
});

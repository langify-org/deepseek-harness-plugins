import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import {
  endRecordedProcesses,
  recordProcesses,
} from '../../../../../src/host/chrome/display/recorded-processes.ts';

const scratch = await mkdtemp(join(tmpdir(), 'dsh-chrome-processes-'));
const children: ChildProcess[] = [];
after(async () => {
  for (const child of children) child.kill('SIGKILL');
  await rm(scratch, { recursive: true, force: true });
});

/** A process that runs until it is ended, naming the path on its command line. */
function running(namedPath: string): {
  readonly child: ChildProcess;
  readonly ended: Promise<void>;
} {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', namedPath], {
    stdio: 'ignore',
  });
  children.push(child);
  return { child, ended: new Promise((resolve) => child.once('exit', () => resolve())) };
}

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

test('ends the processes recorded for the directory that still run for it', {
  skip: process.platform === 'linux' ? false : 'reads /proc',
}, async () => {
  const runtimeDir = join(scratch, 'run');
  await mkdir(runtimeDir);
  const screen = running(join(runtimeDir, 'vnc.sock'));
  // A recorded pid that has gone to a process of another directory since.
  const unrelated = running(join(scratch, 'other', 'vnc.sock'));
  await recordProcesses(runtimeDir, [screen.child.pid ?? 0, unrelated.child.pid ?? 0]);
  // Both have started, and show their command lines.
  await new Promise((resolve) => setTimeout(resolve, 200));

  let ended = false;
  void screen.ended.then(() => {
    ended = true;
  });
  await endRecordedProcesses(runtimeDir);
  // It returns once the process has ended, not merely once it was asked to.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended, true);
  assert.equal(unrelated.child.exitCode, null);
  assert.equal(await exists(join(runtimeDir, 'processes.json')), false);
});

test('kills a process that does not end when asked', {
  skip: process.platform === 'linux' ? false : 'reads /proc',
}, async () => {
  const runtimeDir = join(scratch, 'stubborn');
  await mkdir(runtimeDir);
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)", join(runtimeDir, 'x')],
    { stdio: 'ignore' },
  );
  children.push(child);
  const ended = new Promise((resolve) => child.once('exit', (_code, signal) => resolve(signal)));
  await recordProcesses(runtimeDir, [child.pid ?? 0]);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await endRecordedProcesses(runtimeDir);
  assert.equal(await ended, 'SIGKILL');
});

test('starts afresh without a record, or with one it cannot read', async () => {
  const runtimeDir = await mkdtemp(join(scratch, 'fresh-'));
  await endRecordedProcesses(runtimeDir);
  await writeFile(join(runtimeDir, 'processes.json'), '{ not json');
  await endRecordedProcesses(runtimeDir);
  await writeFile(join(runtimeDir, 'processes.json'), JSON.stringify(['1', -4, 1.5]));
  await endRecordedProcesses(runtimeDir);
});

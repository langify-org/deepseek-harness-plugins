import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

/**
 * The screen's processes, recorded in its runtime directory while they run. Chrome ends when
 * DSH does, since its debugging pipe closes; the X server and the window manager would run on
 * after a DSH that crashed, each holding a display. The next start ends them.
 */
const RECORD_FILE = 'processes.json';
/** How long a process left running may take to end once asked, before it is killed. */
const END_GRACE_MS = 3000;
const END_CHECK_MS = 50;

/** Records the processes started for the directory. */
export async function recordProcesses(runtimeDir: string, pids: readonly number[]): Promise<void> {
  await writeFile(join(runtimeDir, RECORD_FILE), `${JSON.stringify(pids)}\n`);
}

/** Forgets the recorded processes, once they have ended. */
export async function forgetProcesses(runtimeDir: string): Promise<void> {
  await rm(join(runtimeDir, RECORD_FILE), { force: true });
}

/**
 * Ends the processes a start before recorded and that still run for the directory, and
 * returns once they have ended: an X server that ends late would take its socket's path from
 * the one started after it. A process is taken as one of them only if its command line names
 * the directory: its pid may have gone to another process since.
 */
export async function endRecordedProcesses(runtimeDir: string): Promise<void> {
  let recorded: unknown;
  try {
    recorded = JSON.parse(await readFile(join(runtimeDir, RECORD_FILE), 'utf8'));
  } catch {
    return;
  }
  const leftovers: number[] = [];
  for (const pid of Array.isArray(recorded) ? recorded : []) {
    if (!Number.isInteger(pid) || pid <= 0) continue;
    if (await runsFor(pid, runtimeDir)) leftovers.push(pid);
  }
  for (const pid of leftovers) signal(pid, 'SIGTERM');
  const deadline = Date.now() + END_GRACE_MS;
  let running = leftovers;
  while (running.length > 0 && Date.now() < deadline) {
    await sleep(END_CHECK_MS);
    running = await filterAsync(running, (pid) => runsFor(pid, runtimeDir));
  }
  for (const pid of running) signal(pid, 'SIGKILL');
  await forgetProcesses(runtimeDir);
}

/** Whether the process runs, with the directory on its command line. */
async function runsFor(pid: number, runtimeDir: string): Promise<boolean> {
  const commandLine = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
  return commandLine.split('\0').some((arg) => arg.startsWith(`${runtimeDir}/`));
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // It ended meanwhile.
  }
}

async function filterAsync<T>(
  items: readonly T[],
  keep: (item: T) => Promise<boolean>,
): Promise<T[]> {
  const kept = await Promise.all(items.map(keep));
  return items.filter((_item, index) => kept[index]);
}

import type { ChildProcess } from 'node:child_process';

/** How long a process may take to end after it is asked to, before it is killed. */
const STOP_GRACE_MS = 3000;

/** Resolves once the child has exited, or never started (a missing executable). */
export function exitOf(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
    // A child that could not start emits `error` instead; without a listener, the error
    // would be thrown, and an uncaught error ends DSH.
    child.once('error', () => resolve());
  });
}

/** Whether the child exits within the time, as asked to by other means. */
export function exitsWithin(exited: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void exited.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Asks the child to end, and kills it if it has not after a while. */
export async function stopProcess(child: ChildProcess, exited: Promise<void>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), STOP_GRACE_MS);
  await exited;
  clearTimeout(timer);
}

/** The message of a spawn error, saying what to install when the executable is missing. */
export function startFailure(
  what: string,
  executable: string,
  error: unknown,
  hint: string,
): Error {
  const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
  return new Error(
    missing
      ? `${what} (${executable}) was not found: ${hint}`
      : `could not start ${what} (${executable}): ${error instanceof Error ? error.message : String(error)}`,
  );
}

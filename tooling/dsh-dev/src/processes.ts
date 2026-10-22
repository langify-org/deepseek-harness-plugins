import { spawn } from 'node:child_process';
import { DshDevError } from './errors.ts';

export interface ProcessOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Drop what the command writes to its standard output; its errors still show. */
  readonly quiet?: boolean;
}

export class CommandFailedError extends DshDevError {
  constructor(command: string, args: readonly string[], outcome: string) {
    super(`${[command, ...args].join(' ')} ${outcome}`);
  }
}

/** Runs a command to its end, on this terminal. */
export async function run(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<void> {
  const code = await runForeground(command, args, options);
  if (code !== 0) throw new CommandFailedError(command, args, `exited with code ${code}`);
}

/**
 * Runs a command in the foreground, as if typed into this terminal: the terminal's
 * interrupt and termination signals reach it, and this process waits for it.
 * @returns its exit code, 128 plus the signal's number when a signal ended it.
 */
export function runForeground(
  command: string,
  args: readonly string[],
  options: ProcessOptions,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['inherit', options.quiet === true ? 'ignore' : 'inherit', 'inherit'],
    });
    // The terminal sends an interrupt to the whole process group; the child shuts down
    // itself, and this process only waits for it.
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const forward = (signal: NodeJS.Signals) => {
      if (signal !== 'SIGINT') child.kill(signal);
    };
    for (const signal of signals) process.on(signal, forward);
    const stopForwarding = () => {
      for (const signal of signals) process.off(signal, forward);
    };
    child.once('error', (error) => {
      stopForwarding();
      reject(new CommandFailedError(command, args, `could not start: ${error.message}`));
    });
    child.once('exit', (code, signal) => {
      stopForwarding();
      resolve(code ?? 128 + signalNumber(signal));
    });
  });
}

function signalNumber(signal: NodeJS.Signals | null): number {
  const numbers: Partial<Record<NodeJS.Signals, number>> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return (signal === null ? undefined : numbers[signal]) ?? 1;
}

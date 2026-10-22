import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type { DshRuntime } from './dsh-runtime.ts';

/**
 * The development DSH's home (its `DSH_HOME`): `.dsh-home` at the repository root, kept
 * out of git. DSH keeps its profiles, sessions and credentials there, as in any home, and
 * dsh-dev adds what it prepares for DSH:
 *
 * - `packages/`: the workspace's plugins, packed as DSH installs them.
 * - `bin/pnpm`: the pnpm DSH ships, for DSH's plugin commands, which look for `pnpm` on PATH.
 */
export class DevHome {
  readonly root: string;
  /** The profile the development DSH serves: DSH's own Web profile. */
  readonly profile = 'web';

  constructor(root: string) {
    this.root = root;
  }

  static of(repositoryRoot: string): DevHome {
    return new DevHome(join(repositoryRoot, '.dsh-home'));
  }

  get profileDir(): string {
    return join(this.root, 'profiles', this.profile);
  }

  get packagesDir(): string {
    return join(this.root, 'packages');
  }

  get binDir(): string {
    return join(this.root, 'bin');
  }

  /** Readies the home for DSH to run on the runtime. */
  async prepare(runtime: DshRuntime): Promise<void> {
    await mkdir(this.packagesDir, { recursive: true });
    await mkdir(this.binDir, { recursive: true });
    const pnpm = join(this.binDir, 'pnpm');
    await writeFile(
      pnpm,
      [
        '#!/bin/sh',
        '# The pnpm DSH ships, for the development DSH. Written by dsh-dev.',
        `exec ${shellQuote(runtime.node)} ${shellQuote(runtime.pnpm)} "$@"`,
        '',
      ].join('\n'),
    );
    await chmod(pnpm, 0o755);
  }

  /**
   * The environment DSH runs in: this home, and its `bin/` first on PATH. Left out are the
   * variables a surrounding DSH sets for its own processes (when this runs in DSH Desktop's
   * terminal, say), which would point the development DSH at another home, and those pnpm
   * sets for the scripts it runs, which DSH's own pnpm would take for its configuration.
   */
  environment(inherited: Readonly<Record<string, string | undefined>>): Record<string, string> {
    const environment: Record<string, string> = {};
    for (const [name, value] of Object.entries(inherited)) {
      if (value === undefined || !isPassedOn(name)) continue;
      environment[name] = value;
    }
    environment['DSH_HOME'] = this.root;
    environment['PATH'] = [this.binDir, inherited['PATH']].filter(Boolean).join(delimiter);
    return environment;
  }
}

/** Whether a variable of the environment dsh-dev runs in is passed on to DSH. */
function isPassedOn(name: string): boolean {
  const lower = name.toLowerCase();
  return !(
    name.startsWith('DSH_') ||
    name === 'ELECTRON_RUN_AS_NODE' ||
    lower.startsWith('npm_') ||
    lower.startsWith('pnpm_') ||
    name === 'INIT_CWD'
  );
}

/** The text as one word for a POSIX shell. */
function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

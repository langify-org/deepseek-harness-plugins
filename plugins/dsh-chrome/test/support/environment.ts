import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package's build output, which the compat and integration tests load. */
export const distDir = fileURLToPath(new URL('../../dist', import.meta.url));

/** The Chrome the integration tests start. */
export const chromeExecutable = process.env['DSH_CHROME_TEST_EXECUTABLE'] ?? 'google-chrome-stable';
/** The X server and window manager the integration tests run that Chrome under. */
export const xvncExecutable = 'Xvnc';
export const windowManagerExecutable = 'openbox';

/** Why a test file cannot run here (for `skip`), or `false` when it can. */
export async function missingRequirements(needs: {
  readonly chrome?: boolean;
}): Promise<string | false> {
  if (!(await exists(join(distDir, 'host', 'index.js'))))
    return 'needs a build: run `pnpm build` first';
  if (needs.chrome !== true) return false;
  if (process.platform !== 'linux') return 'needs Linux (Xvnc)';
  for (const program of [chromeExecutable, xvncExecutable, windowManagerExecutable]) {
    if (!(await onPath(program))) return `needs ${program} on PATH`;
  }
  return false;
}

async function onPath(program: string): Promise<boolean> {
  if (program.includes('/')) return exists(program);
  for (const directory of (process.env['PATH'] ?? '').split(delimiter)) {
    if (await exists(join(directory, program))) return true;
  }
  return false;
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

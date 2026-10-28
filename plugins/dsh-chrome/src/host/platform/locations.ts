import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths';

/**
 * Default places on this machine. Each is overridable in the plugin configuration.
 *
 * dsh-chrome keeps its files in the DSH home, with the rest of DSH's data, so that each
 * DSH installation (Desktop, a `dsh web` of one's own, a development one) has its own Chrome.
 */

/** The user data directory of the user's own Chrome, where native apps register themselves. */
export function defaultUserChromeDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'google-chrome');
}

/** Where dsh-chrome keeps what it records between starts. */
export function defaultDataDir(): string {
  return dshHomePath('dsh-chrome');
}

/** The Chrome user data directory dsh-chrome owns. */
export function defaultProfileDir(): string {
  return join(defaultDataDir(), 'chrome-profile');
}

/** Where 0.2 kept the profile, as its "dedicated" profile. */
export function earlierProfileDirs(): string[] {
  return [join(defaultDataDir(), 'profiles', 'dedicated')];
}

/**
 * The directory of the screen's VNC socket: one per DSH home, so that DSH installations with
 * different homes can run at once. It is in the per-user runtime directory, which only this
 * user can enter and which disappears on logout, and is named by a digest of the home, since
 * a socket's path must stay short.
 */
export function defaultRuntimeDir(): string {
  const runtimeDir = process.env['XDG_RUNTIME_DIR'];
  const directory =
    runtimeDir === undefined || runtimeDir === ''
      ? join(tmpdir(), `dsh-chrome-${process.getuid?.() ?? 'user'}`)
      : join(runtimeDir, 'dsh-chrome');
  const home = createHash('sha256').update(resolveDshHome()).digest('hex').slice(0, 12);
  return join(directory, home);
}

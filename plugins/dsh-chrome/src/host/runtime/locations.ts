import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { dshHomePath, resolveDshHome } from '@deepseek-ai/dsh-home-paths';

/**
 * Default places on this machine. Each is overridable in the plugin configuration.
 *
 * dsh-chrome keeps its files in the DSH home, with the rest of DSH's data, so that each
 * DSH installation (Desktop, a `dsh web` of one's own, a development one) has its own.
 */

/** Chrome's default user data directory: where the daily profile's Chrome keeps its data. */
export function defaultChromeUserDataDir(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
  }
  return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'google-chrome');
}

/** Where dsh-chrome keeps the connector files that Chrome loads. */
export function defaultDataDir(): string {
  return dshHomePath('dsh-chrome');
}

/** The user data directory of the profile dsh-chrome owns. */
export function defaultDedicatedUserDataDir(): string {
  return join(defaultDataDir(), 'profiles', 'dedicated');
}

/**
 * The connector socket: one per DSH home, so that DSH installations with different homes
 * can run at once. It lives in the per-user runtime directory, which disappears on logout,
 * and is named by a digest of the home, since a socket path must stay short.
 */
export function defaultConnectorSocketPath(): string {
  const runtimeDir = process.env['XDG_RUNTIME_DIR'];
  const directory =
    runtimeDir === undefined || runtimeDir === ''
      ? join(tmpdir(), `dsh-chrome-${process.getuid?.() ?? 'user'}`)
      : join(runtimeDir, 'dsh-chrome');
  const home = createHash('sha256').update(resolveDshHome()).digest('hex').slice(0, 12);
  return join(directory, `${home}.sock`);
}

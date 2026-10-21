import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Default places on this machine. Each is overridable in the plugin configuration;
 * these follow the platform's conventions (XDG base directories on Linux).
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
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'dsh-chrome');
  }
  return join(process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'), 'dsh-chrome');
}

/** The user data directory of the profile dsh-chrome owns. */
export function defaultDedicatedUserDataDir(): string {
  return join(defaultDataDir(), 'profiles', 'dedicated');
}

/** The connector socket. It lives in a per-user runtime directory that disappears on logout. */
export function defaultConnectorSocketPath(): string {
  const runtimeDir = process.env['XDG_RUNTIME_DIR'];
  const directory =
    runtimeDir === undefined
      ? join(tmpdir(), `dsh-chrome-${process.getuid?.() ?? 'user'}`)
      : join(runtimeDir, 'dsh-chrome');
  return join(directory, 'connector.sock');
}

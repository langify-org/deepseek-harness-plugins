import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Versions before 0.3 reached Chrome through a connector extension and a native messaging
 * relay, which this version no longer has. What they wrote is taken back here: the copies
 * of the connector and the relay in dsh-chrome's data directory, and the relay's native
 * messaging manifest in each Chrome user data directory, if it is still theirs.
 */
const RELAY_HOST_NAME = 'io.github.langify_org.dsh_chrome';
const RELAY_FILES = ['extension', 'extension.new', 'native-host.mjs'];

export interface EarlierVersionPlaces {
  readonly dataDir: string;
  /** The user's own Chrome's user data directory, where 0.1 registered its relay. */
  readonly userChromeDir: string;
  /** dsh-chrome's profile, where 0.2 registered its relay for the profile it ran. */
  readonly profileDir: string;
}

/** @returns what could not be removed, for the log. */
export async function removeEarlierVersionFiles(places: EarlierVersionPlaces): Promise<string[]> {
  const warnings: string[] = [];
  const remove = (path: string) =>
    rm(path, { recursive: true, force: true }).catch((error: unknown) =>
      warnings.push(`could not remove ${path}: ${messageOf(error)}`),
    );
  for (const [chromeDir, launcher] of [
    [places.userChromeDir, 'native-host-daily'],
    [places.profileDir, 'native-host-dedicated'],
  ] as const) {
    const launcherPath = join(places.dataDir, launcher);
    const manifestPath = join(chromeDir, 'NativeMessagingHosts', `${RELAY_HOST_NAME}.json`);
    // Another DSH home may have registered its own relay there since; that one stays.
    if ((await manifestLauncher(manifestPath)) === launcherPath) await remove(manifestPath);
    await remove(launcherPath);
  }
  for (const file of RELAY_FILES) await remove(join(places.dataDir, file));
  return warnings;
}

/** The program a native messaging manifest starts, if the file is one. */
async function manifestLauncher(path: string): Promise<string | undefined> {
  try {
    const manifest: unknown = JSON.parse(await readFile(path, 'utf8'));
    return typeof manifest === 'object' && manifest !== null && 'path' in manifest
      ? String(manifest.path)
      : undefined;
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

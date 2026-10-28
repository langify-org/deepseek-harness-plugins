import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { hostname } from 'node:os';
import { basename, join, relative, sep } from 'node:path';

/** A profile of the user's own Chrome, as its Local State lists it. */
export interface UserChromeProfile {
  /** The profile's directory in Chrome's user data directory: `Default`, `Profile 1`, … */
  readonly directory: string;
  /** The name the user gave it. */
  readonly name: string;
  /** The Google account it is signed in to, if any. */
  readonly account: string | undefined;
}

/** The user's own Chrome, as its user data directory shows it. */
export interface UserChrome {
  readonly profiles: readonly UserChromeProfile[];
  /** Whether it runs: a profile copied meanwhile may miss what Chrome has not written yet. */
  readonly running: boolean;
}

/** The profile dsh-chrome's Chrome runs, in its user data directory. */
const PROFILE_DIRECTORY = 'Default';
/**
 * Where a copy is made, beside the profile it replaces, on the same file system: this, and a
 * name of the copy's own.
 */
const STAGING_PREFIX = 'Default.copying-';
/** Where the profile a copy replaced is kept, until the next copy. */
export const REPLACED_PROFILE_DIRECTORY = 'Default.before-copy';
/** How many times a database that changed while it was copied is copied again. */
const DATABASE_COPY_ATTEMPTS = 3;
const SQLITE_HEADER = 'SQLite format 3\0';

/**
 * What a copy leaves out, by path in the profile:
 * - caches, which Chrome fills again;
 * - the open windows and tabs, which dsh-chrome's Chrome would otherwise restore, and the
 *   pages' session storage, which belongs to them;
 * - what makes the profile a device of the user's account (Chrome Sync's data, and the push
 *   messaging registration), so that the copy signs in as a device of its own rather than
 *   as the same one twice.
 */
const LEFT_OUT = new Set([
  'blob_storage',
  join('Service Worker', 'CacheStorage'),
  join('Service Worker', 'ScriptCache'),
  'Sessions',
  'Sessions_Encrypted',
  'Current Session',
  'Current Tabs',
  'Last Session',
  'Last Tabs',
  'Session Storage',
  'Sync Data',
  'GCM Store',
]);

/** Caches Chrome fills again, left out wherever they are: extensions' storage has them too. */
const CACHES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
]);

/** Whether a copy leaves out the path, relative to the profile. */
function leftOut(path: string): boolean {
  return LEFT_OUT.has(path) || CACHES.has(basename(path));
}

/** Reads which profiles the user's Chrome has, and whether it runs. */
export async function readUserChrome(userChromeDir: string): Promise<UserChrome> {
  let localState: unknown;
  try {
    localState = JSON.parse(await readFile(join(userChromeDir, 'Local State'), 'utf8'));
  } catch (error) {
    throw new Error(
      `found no Chrome profiles in ${userChromeDir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const cache = record(record(record(localState)?.['profile'])?.['info_cache']) ?? {};
  const entries = await readdir(userChromeDir, { withFileTypes: true }).catch(() => []);
  const directories = new Set(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );
  const profiles = Object.entries(cache).flatMap(([directory, value]): UserChromeProfile[] => {
    const info = record(value);
    if (info === undefined || !directories.has(directory) || !isProfileDirectory(directory)) {
      return [];
    }
    const name = typeof info['name'] === 'string' && info['name'] !== '' ? info['name'] : directory;
    const account =
      typeof info['user_name'] === 'string' && info['user_name'] !== ''
        ? info['user_name']
        : undefined;
    return [{ directory, name, account }];
  });
  return { profiles, running: await chromeRuns(userChromeDir) };
}

/** A copy of a profile, beside dsh-chrome's, to take its place once Chrome is closed. */
export interface StagedProfile {
  /** Puts the copy in place of dsh-chrome's profile, which is kept aside until the next copy. */
  install(): Promise<void>;
  /** Removes the copy. */
  discard(): Promise<void>;
}

/**
 * How far a copy has come: while it copies files, the bytes of those it began and of all it
 * takes, `final` once they are all copied; then how many of the databases it copied it has
 * checked.
 */
export type ProfileCopyProgress =
  | {
      readonly step: 'files';
      readonly copiedBytes: number;
      readonly totalBytes: number;
      readonly final: boolean;
    }
  | { readonly step: 'databases'; readonly checked: number; readonly total: number };

export interface ProfileCopyOptions {
  readonly userChromeDir: string;
  /** The profile to copy: one {@link readUserChrome} lists. */
  readonly directory: string;
  /** dsh-chrome's Chrome user data directory. */
  readonly profileDir: string;
  /** Stops the copy, which then leaves nothing behind. */
  readonly signal?: AbortSignal | undefined;
  /** Hears how far the copy has come, as often as each file it copies. */
  readonly onProgress?: ((progress: ProfileCopyProgress) => void) | undefined;
}

/**
 * Copies a profile of the user's Chrome beside dsh-chrome's, with what it keeps of the user:
 * sign-ins, saved passwords, bookmarks, history, extensions and their data, site data and
 * settings. Chrome on Linux encrypts sign-ins and passwords with a key the user's keyring
 * keeps for every Chrome of the user, so dsh-chrome's Chrome reads them.
 *
 * The user's Chrome may run meanwhile: a database it writes while it is copied is copied
 * again, until a copy of it is whole.
 * @throws when the profile is not one the user's Chrome lists, or a copy is not whole.
 */
export async function stageProfileCopy(options: ProfileCopyOptions): Promise<StagedProfile> {
  const { profiles } = await readUserChrome(options.userChromeDir);
  if (!profiles.some((profile) => profile.directory === options.directory)) {
    throw new Error(`your Chrome has no profile "${options.directory}"`);
  }
  const { signal, onProgress } = options;
  signal?.throwIfAborted();
  const source = join(options.userChromeDir, options.directory);
  const staging = join(options.profileDir, STAGING_PREFIX + randomBytes(6).toString('hex'));
  await mkdir(options.profileDir, { recursive: true, mode: 0o700 });
  try {
    const totalBytes = await bytesToCopy(source, signal);
    let copiedBytes = 0;
    onProgress?.({ step: 'files', copiedBytes, totalBytes, final: false });
    await cp(source, staging, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      // Called for each file before it is copied: an aborted copy stops at the next, and a file
      // counts as copied once begun.
      filter: async (path) => {
        signal?.throwIfAborted();
        if (leftOut(relative(source, path))) return false;
        const info = await lstat(path).catch(() => undefined);
        if (info?.isFile()) {
          copiedBytes += info.size;
          onProgress?.({ step: 'files', copiedBytes, totalBytes, final: false });
        }
        return true;
      },
    });
    onProgress?.({ step: 'files', copiedBytes, totalBytes, final: true });
    await copyDatabasesWhole(source, staging, signal, (checked, total) =>
      onProgress?.({ step: 'databases', checked, total }),
    );
    await makeDeviceOfItsOwn(join(staging, 'Preferences'));
    signal?.throwIfAborted();
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  return {
    install: async () => {
      const current = join(options.profileDir, PROFILE_DIRECTORY);
      const replaced = join(options.profileDir, REPLACED_PROFILE_DIRECTORY);
      await rm(replaced, { recursive: true, force: true });
      await rename(current, replaced).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await rename(staging, current);
    },
    discard: () => rm(staging, { recursive: true, force: true }),
  };
}

/** Removes the copies earlier runs left unfinished. */
export async function removeUnfinishedCopy(profileDir: string): Promise<void> {
  const entries = await readdir(profileDir).catch(() => []);
  for (const entry of entries) {
    if (entry.startsWith(STAGING_PREFIX)) {
      await rm(join(profileDir, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Copies each SQLite database of the copy again, together with its journal, and checks it,
 * until a copy is whole: the user's Chrome may have been writing it, and the first copy took
 * a database and its journal at different moments.
 */
async function copyDatabasesWhole(
  source: string,
  copy: string,
  signal: AbortSignal | undefined,
  onChecked: (checked: number, total: number) => void,
): Promise<void> {
  const sqlite = await import('node:sqlite').catch(() => undefined);
  // Without SQLite (an older Node), the copy stays as it is.
  if (sqlite === undefined) return;
  const databases: string[] = [];
  for (const path of await files(copy)) {
    signal?.throwIfAborted();
    if (await isSqlite(path)) databases.push(path);
  }
  onChecked(0, databases.length);
  for (const [index, path] of databases.entries()) {
    const name = relative(copy, path);
    for (let attempt = 1; ; attempt += 1) {
      signal?.throwIfAborted();
      // The journal first: a transaction the database's copy then misses has no pages in it.
      for (const suffix of ['-journal', '-wal', '']) {
        await copyFile(join(source, name + suffix), path + suffix).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error;
            return rm(path + suffix, { force: true });
          },
        );
      }
      if (isWhole(sqlite, path)) break;
      if (attempt >= DATABASE_COPY_ATTEMPTS) {
        throw new Error(
          `${name} changed each time it was copied: close your Chrome, and copy the profile again`,
        );
      }
    }
    onChecked(index + 1, databases.length);
  }
}

function isWhole(sqlite: typeof import('node:sqlite'), path: string): boolean {
  let database: import('node:sqlite').DatabaseSync | undefined;
  try {
    // Opening it plays back a journal copied with it, as Chrome would.
    database = new sqlite.DatabaseSync(path);
    // The full check: also whether each index agrees with its table.
    const row = database.prepare('PRAGMA integrity_check').get() as
      | Record<string, unknown>
      | undefined;
    return row !== undefined && Object.values(row)[0] === 'ok';
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

/**
 * Makes the copy a device of its own: it forgets the identity Chrome Sync and invalidations
 * know the copied profile by, and that its Chrome was running, which would have dsh-chrome's
 * Chrome offer to restore pages it does not have.
 */
async function makeDeviceOfItsOwn(preferencesPath: string): Promise<void> {
  let preferences: unknown;
  try {
    preferences = JSON.parse(await readFile(preferencesPath, 'utf8'));
  } catch {
    return;
  }
  const root = record(preferences);
  if (root === undefined) return;
  const sync = record(root['sync']);
  if (sync !== undefined) {
    delete sync['transport_data_per_account'];
    delete sync['local_device_guids_with_timestamp'];
  }
  delete root['invalidation'];
  const profile = record(root['profile']);
  if (profile !== undefined) profile['exit_type'] = 'Normal';
  await writeFile(preferencesPath, JSON.stringify(preferences), { mode: 0o600 });
}

/** Whether a Chrome holds the user data directory: its lock names a live process here. */
async function chromeRuns(userChromeDir: string): Promise<boolean> {
  let lock: string;
  try {
    lock = await readlink(join(userChromeDir, 'SingletonLock'));
  } catch {
    return false;
  }
  const separator = lock.lastIndexOf('-');
  const host = lock.slice(0, separator);
  const pid = Number(lock.slice(separator + 1));
  if (host !== hostname() || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The bytes of the files a copy of the profile takes: all but what it leaves out. */
async function bytesToCopy(source: string, signal: AbortSignal | undefined): Promise<number> {
  let total = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      signal?.throwIfAborted();
      const path = join(directory, entry.name);
      if (leftOut(relative(source, path))) continue;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) total += (await lstat(path).catch(() => undefined))?.size ?? 0;
    }
  };
  await visit(source);
  return total;
}

async function files(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

async function isSqlite(path: string): Promise<boolean> {
  const file = await open(path, constants.O_RDONLY);
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    return bytesRead === header.length && header.toString('latin1') === SQLITE_HEADER;
  } finally {
    await file.close();
  }
}

/** A profile's directory name: one path segment Chrome names its profiles with. */
function isProfileDirectory(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !name.includes(sep) && !name.includes('/');
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

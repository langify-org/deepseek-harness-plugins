import { mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Sharing the native apps of one Chrome user data directory with another: a link in the
 * other's `NativeMessagingHosts` to each native messaging manifest of the first. Chrome then
 * lets the other profile's extensions start those apps,
 * as 1Password's extension starts its desktop app; each manifest still names the only
 * extensions it accepts.
 *
 * The links are recorded, so that those no longer wanted (sharing turned off, an app
 * removed) are taken back. A link already pointing at the manifest is taken
 * as one of them; anything else in its place, a link the user changed or a file, is left alone.
 */
export interface NativeHostSharing {
  /** The `NativeMessagingHosts` directory whose manifests are shared. */
  readonly from: string;
  /** The `NativeMessagingHosts` directory that gets the links. */
  readonly to: string;
}

/**
 * Makes the wanted links and takes back the ones made before and no longer wanted.
 * @param recordPath - where the links made are recorded, between starts.
 * @returns what could not be done, for the log: sharing is best-effort.
 */
export async function shareNativeHosts(
  recordPath: string,
  sharings: readonly NativeHostSharing[],
): Promise<string[]> {
  const warnings: string[] = [];
  const made = await readRecord(recordPath, warnings);
  const wanted: Record<string, string> = {};
  for (const { from, to } of sharings) {
    const manifests = await readdir(from).catch((): string[] => []);
    for (const file of manifests) {
      if (!file.endsWith('.json')) continue;
      const target = join(from, file);
      const link = join(to, file);
      try {
        const present = await entryAt(link);
        if (present.kind === 'nothing') {
          await mkdir(to, { recursive: true });
          await symlink(target, link);
        }
        if (present.kind === 'nothing' || (present.kind === 'link' && present.target === target)) {
          wanted[link] = target;
        }
      } catch (error) {
        warnings.push(`could not share the native app ${file}: ${messageOf(error)}`);
      }
    }
  }
  for (const [link, target] of Object.entries(made)) {
    if (wanted[link] === target) continue;
    try {
      const present = await entryAt(link);
      if (present.kind === 'link' && present.target === target) await rm(link, { force: true });
    } catch (error) {
      warnings.push(`could not take back the link ${link}: ${messageOf(error)}`);
    }
  }
  await writeFile(recordPath, `${JSON.stringify({ links: wanted }, null, 2)}\n`).catch(
    (error: unknown) =>
      warnings.push(`could not record the shared native apps: ${messageOf(error)}`),
  );
  return warnings;
}

/** What is at a path: nothing, a link and where it points, or something else. */
type Entry =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'link'; readonly target: string }
  | { readonly kind: 'other' };

/** @throws when the path cannot be looked at, as when its directory is a file. */
async function entryAt(path: string): Promise<Entry> {
  try {
    return { kind: 'link', target: await readlink(path) };
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return { kind: 'nothing' };
    // A file or a directory, which is not a link.
    if (isErrorCode(error, 'EINVAL')) return { kind: 'other' };
    throw error;
  }
}

async function readRecord(path: string, warnings: string[]): Promise<Record<string, string>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (!isErrorCode(error, 'ENOENT')) warnings.push(`could not read ${path}: ${messageOf(error)}`);
    return {};
  }
  try {
    const links: unknown = (JSON.parse(text) as { links?: unknown }).links;
    if (typeof links !== 'object' || links === null) return {};
    return Object.fromEntries(
      Object.entries(links).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
  } catch {
    warnings.push(`${path} is not JSON; links made before it was written are left as they are`);
    return {};
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

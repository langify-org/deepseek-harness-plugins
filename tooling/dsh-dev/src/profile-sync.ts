import { join, sep } from 'node:path';
import { jsonField, readJsonFile } from './json-files.ts';
import type { PluginPack } from './plugin-packs.ts';

/** The plugin commands that make a profile's workspace plugins exactly the given packs. */
export interface ProfileSync {
  /** Packs to install: new plugins, and plugins whose pack changed. */
  readonly add: readonly string[];
  /** Plugins to uninstall: installed from the workspace before, and no longer in it. */
  readonly remove: readonly string[];
}

/**
 * Plans how a profile's plugins follow the workspace. A profile dependency counts as the
 * workspace's when it is installed from the packages directory; others, which the
 * developer installed into the development DSH by hand, are left alone.
 * @param installed - the profile's dependencies: package names and their specifiers.
 */
export function planProfileSync(
  installed: Readonly<Record<string, string>>,
  packs: readonly PluginPack[],
  packagesDir: string,
): ProfileSync {
  const fromWorkspace = `file:${packagesDir}${sep}`;
  const packed = new Set(packs.map((pack) => pack.name));
  return {
    add: packs
      .filter((pack) => installed[pack.name] !== `file:${pack.path}`)
      .map((pack) => pack.path),
    remove: Object.entries(installed)
      .filter(([name, specifier]) => specifier.startsWith(fromWorkspace) && !packed.has(name))
      .map(([name]) => name),
  };
}

/** The profile's dependencies, from its package.json; none before DSH created the profile. */
export async function installedDependencies(profileDir: string): Promise<Record<string, string>> {
  const dependencies = jsonField(
    await readJsonFile(join(profileDir, 'package.json')),
    'dependencies',
  );
  if (typeof dependencies !== 'object' || dependencies === null) return {};
  return Object.fromEntries(
    Object.entries(dependencies).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

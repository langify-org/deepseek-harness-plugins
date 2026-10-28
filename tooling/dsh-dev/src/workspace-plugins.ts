import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DshDevError } from './errors.ts';
import { jsonField, readJsonFile } from './json-files.ts';

/** A DSH plugin package of the workspace. */
export interface WorkspacePlugin {
  readonly name: string;
  readonly version: string;
  /** The package directory. */
  readonly dir: string;
}

/** Where the workspace keeps its plugins, one package per directory (see pnpm-workspace.yaml). */
const PLUGINS_DIR = 'plugins';

/**
 * The workspace's DSH plugins: the packages under `plugins/` that declare a `dsh` field.
 * @throws DshDevError when a package's manifest is not JSON, or a plugin's lacks its name or
 * version.
 */
export async function workspacePlugins(repositoryRoot: string): Promise<WorkspacePlugin[]> {
  const pluginsDir = join(repositoryRoot, PLUGINS_DIR);
  const entries = await readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
  const plugins: WorkspacePlugin[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const dir = join(pluginsDir, entry.name);
    const manifest = await readJsonFile(join(dir, 'package.json'));
    if (jsonField(manifest, 'dsh') === undefined) continue;
    const name = jsonField(manifest, 'name');
    const version = jsonField(manifest, 'version');
    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new DshDevError(`${join(dir, 'package.json')} names no package name and version`);
    }
    plugins.push({ name, version, dir });
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { DshDevError } from './errors.ts';
import { run } from './processes.ts';
import type { WorkspacePlugin } from './workspace-plugins.ts';

/** A plugin, packed as DSH installs it: the npm tarball of its package. */
export interface PluginPack {
  readonly name: string;
  readonly version: string;
  readonly path: string;
}

/** Builds the plugin with the workspace's pnpm and packs it into the packages directory. */
export async function packPlugin(
  plugin: WorkspacePlugin,
  packagesDir: string,
): Promise<PluginPack> {
  await run('pnpm', ['run', 'build'], { cwd: plugin.dir });
  const packing = await mkdtemp(join(packagesDir, '.packing-'));
  try {
    // pnpm lists every file it packs; the build already showed what went wrong, if anything.
    await run('pnpm', ['pack', '--pack-destination', packing], { cwd: plugin.dir, quiet: true });
    const [tarball, ...others] = (await readdir(packing)).filter((file) => file.endsWith('.tgz'));
    if (tarball === undefined || others.length > 0) {
      throw new DshDevError(`packing ${plugin.name} did not leave exactly one tarball`);
    }
    return await storePack(join(packing, tarball), packagesDir, plugin);
  } finally {
    await rm(packing, { recursive: true, force: true });
  }
}

/**
 * Moves a packed tarball into the packages directory, named by its content. A changed
 * plugin thus gets a new file, which DSH installs as a new package, while an unchanged one
 * keeps its file, and DSH has nothing to do.
 */
export async function storePack(
  tarball: string,
  packagesDir: string,
  plugin: Pick<WorkspacePlugin, 'name' | 'version'>,
): Promise<PluginPack> {
  const digest = createHash('sha256')
    .update(await readFile(tarball))
    .digest('hex')
    .slice(0, 12);
  const path = join(packagesDir, `${basename(tarball, '.tgz')}-${digest}.tgz`);
  await rename(tarball, path);
  return { name: plugin.name, version: plugin.version, path };
}

/** Deletes the packs in the packages directory other than the ones given. */
export async function prunePacks(packagesDir: string, kept: ReadonlySet<string>): Promise<void> {
  const files = await readdir(packagesDir).catch((): string[] => []);
  await Promise.all(
    files
      .filter((file) => file.endsWith('.tgz') && !kept.has(join(packagesDir, file)))
      .map((file) => rm(join(packagesDir, file), { force: true })),
  );
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginBuildDeclaration } from './declaration.ts';
import {
  BUNDLE_PATCH_FILE,
  CLIENT_MODULE_FILE,
  DIST_DIR,
  hostPluginFile,
  packageRelative,
} from './layout.ts';

/** The fields of `package.json` that a DSH plugin build reads or holds to the layout. */
export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly exports: Readonly<Record<string, unknown>>;
  readonly files: readonly unknown[];
  readonly peerDependencies: Readonly<Record<string, unknown>>;
  readonly bundlePatch: unknown;
  readonly client: {
    readonly platform: unknown;
    readonly external: readonly string[];
  } | null;
}

export async function readPluginManifest(packageDir: string): Promise<PluginManifest> {
  const path = join(packageDir, 'package.json');
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isRecord(value)) throw new Error(`${path} is not a JSON object`);
  const { name, version } = value;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new Error(`${path} must declare a string "name" and "version"`);
  }
  const dsh = isRecord(value['dsh']) ? value['dsh'] : {};
  const bundle = isRecord(dsh['bundle']) ? dsh['bundle'] : {};
  const client = isRecord(dsh['client']) ? dsh['client'] : null;
  const external = client?.['external'];
  return {
    name,
    version,
    exports: isRecord(value['exports']) ? value['exports'] : {},
    files: Array.isArray(value['files']) ? value['files'] : [],
    peerDependencies: isRecord(value['peerDependencies']) ? value['peerDependencies'] : {},
    bundlePatch: bundle['patch'],
    client:
      client === null
        ? null
        : {
            platform: client['platform'],
            external: Array.isArray(external)
              ? external.filter((item): item is string => typeof item === 'string')
              : [],
          },
  };
}

/**
 * Lists every way `package.json` disagrees with the build declaration and the output
 * layout. The declaration owns the sources; `package.json` owns the published
 * interface; this check keeps the two describing the same package.
 */
export function findManifestProblems(
  manifest: PluginManifest,
  declaration: PluginBuildDeclaration,
): string[] {
  const problems: string[] = [];
  const expectExport = (exportPath: string, file: string) => {
    const actual = manifest.exports[exportPath];
    const expected = packageRelative(file);
    if (actual !== expected) {
      problems.push(
        `exports["${exportPath}"] must be "${expected}", found ${JSON.stringify(actual)}`,
      );
    }
  };

  const ids = new Set<string>();
  for (const plugin of declaration.hostPlugins) {
    if (ids.has(plugin.id)) problems.push(`host plugin id "${plugin.id}" is declared twice`);
    ids.add(plugin.id);
    expectExport(plugin.exportPath, hostPluginFile(plugin.exportPath));
  }

  if (declaration.hostPlugins.length > 0) {
    const expectedPatch = packageRelative(BUNDLE_PATCH_FILE);
    if (manifest.bundlePatch !== expectedPatch) {
      problems.push(
        `dsh.bundle.patch must be "${expectedPatch}", found ${JSON.stringify(manifest.bundlePatch)}`,
      );
    }
  }

  if (declaration.clientModule !== undefined) {
    expectExport('./client', CLIENT_MODULE_FILE);
    if (manifest.client?.platform !== 'web') {
      problems.push('dsh.client.platform must be "web" for a package with a client module');
    }
    if (!declaration.hostPlugins.some((plugin) => plugin.exportPath === '.')) {
      problems.push(
        'a package with a client module must declare a host plugin at export path "." ' +
          '(DSH serves a browser module only for Loader rows that name the bare package)',
      );
    }
  }

  const programNames = new Set<string>();
  for (const program of declaration.nodePrograms ?? []) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(program.name)) {
      problems.push(`node program name "${program.name}" must be lowercase kebab-case`);
    }
    if (programNames.has(program.name)) {
      problems.push(`node program "${program.name}" is declared twice`);
    }
    programNames.add(program.name);
  }

  if (!manifest.files.includes(DIST_DIR)) {
    problems.push(`files must include "${DIST_DIR}" so the build output is published`);
  }
  return problems;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { build, type Metafile } from 'esbuild';
import { renderBundlePatch } from './bundle-patch.ts';
import { CLIENT_MODULE_FOOTER, clientModuleBanner, PLATFORM_MODULES } from './client-module.ts';
import type { PluginBuildDeclaration } from './declaration.ts';
import {
  BUNDLE_PATCH_FILE,
  CLIENT_MODULE_FILE,
  DIST_DIR,
  HOST_PLUGIN_DIR,
  hostPluginName,
  nodeProgramFile,
} from './layout.ts';
import { findManifestProblems, type PluginManifest, readPluginManifest } from './manifest.ts';

/** DSH Desktop 0.2 runs host plugins on its bundled Node 24. */
const NODE_TARGET = 'node24';
/**
 * Bundled CommonJS dependencies call `require`, which ES modules lack. Each host
 * output defines one from its own URL, so those calls keep working.
 */
const NODE_REQUIRE_BANNER =
  "import { createRequire as __dshPluginCreateRequire } from 'node:module';\n" +
  'const require = __dshPluginCreateRequire(import.meta.url);';
/** A conservative syntax level for the browsers that open the DSH web client. */
const BROWSER_TARGET = 'es2022';

export class PluginBuildError extends Error {
  readonly problems: readonly string[];

  constructor(packageDir: string, problems: readonly string[]) {
    super(`Cannot build ${packageDir}:\n${problems.map((problem) => `  - ${problem}`).join('\n')}`);
    this.name = 'PluginBuildError';
    this.problems = problems;
  }
}

/**
 * Builds a plugin package into `dist/`: host plugins as Node ES modules, the client
 * module as a DSH module factory, standalone Node programs, and the bundle patch.
 *
 * Imports provided by DSH stay external. The build fails when a bundle depends on
 * something DSH would not provide at runtime, or when `package.json` disagrees
 * with the declaration.
 */
export async function buildPlugin(declaration: PluginBuildDeclaration): Promise<void> {
  const { packageDir } = declaration;
  const manifest = await readPluginManifest(packageDir);
  const problems = findManifestProblems(manifest, declaration);
  if (problems.length > 0) throw new PluginBuildError(packageDir, problems);

  await rm(join(packageDir, DIST_DIR), { recursive: true, force: true });

  if (declaration.hostPlugins.length > 0) {
    const result = await build({
      absWorkingDir: packageDir,
      entryPoints: Object.fromEntries(
        declaration.hostPlugins.map((plugin) => [hostPluginName(plugin.exportPath), plugin.source]),
      ),
      outdir: HOST_PLUGIN_DIR,
      chunkNames: 'chunks/[name]-[hash]',
      bundle: true,
      splitting: true,
      format: 'esm',
      platform: 'node',
      target: NODE_TARGET,
      external: ['@deepseek-ai/*', ...(declaration.optionalHostModules ?? [])],
      banner: { js: NODE_REQUIRE_BANNER },
      sourcemap: 'linked',
      metafile: true,
      logLevel: 'warning',
    });
    problems.push(...findUndeclaredHostImports(result.metafile, manifest));
    await writeOutput(
      packageDir,
      BUNDLE_PATCH_FILE,
      renderBundlePatch(manifest.name, declaration.hostPlugins),
    );
  }

  if (declaration.clientModule !== undefined) {
    const result = await build({
      absWorkingDir: packageDir,
      entryPoints: [declaration.clientModule.source],
      outfile: CLIENT_MODULE_FILE,
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: BROWSER_TARGET,
      jsx: 'automatic',
      // Everything the shell could provide stays a `require` for the module loader;
      // the import check below rejects whatever it would not provide.
      external: [...PLATFORM_MODULES, '@deepseek-ai/*', 'react', 'react-dom'],
      banner: { js: clientModuleBanner(manifest.name) },
      footer: { js: CLIENT_MODULE_FOOTER },
      sourcemap: 'linked',
      metafile: true,
      logLevel: 'warning',
    });
    problems.push(...findUnavailableClientImports(result.metafile, manifest));
  }

  for (const program of declaration.nodePrograms ?? []) {
    const result = await build({
      absWorkingDir: packageDir,
      entryPoints: [program.source],
      outfile: nodeProgramFile(program.name),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: NODE_TARGET,
      banner: { js: NODE_REQUIRE_BANNER },
      sourcemap: 'linked',
      metafile: true,
      logLevel: 'warning',
    });
    problems.push(...findNonBuiltinImports(result.metafile, program.name));
  }

  if (problems.length > 0) throw new PluginBuildError(packageDir, problems);
}

/** DSH packages a host plugin imports at runtime are part of its contract with DSH. */
function findUndeclaredHostImports(metafile: Metafile, manifest: PluginManifest): string[] {
  const missing = new Set<string>();
  for (const path of externalImports(metafile)) {
    const packageName = path.split('/').slice(0, 2).join('/');
    if (path.startsWith('@deepseek-ai/') && !(packageName in manifest.peerDependencies)) {
      missing.add(packageName);
    }
  }
  return [...missing].map(
    (name) => `host code imports ${name} at runtime; declare it in peerDependencies`,
  );
}

function findUnavailableClientImports(metafile: Metafile, manifest: PluginManifest): string[] {
  const available = new Set([...PLATFORM_MODULES, ...(manifest.client?.external ?? [])]);
  return [...new Set(externalImports(metafile))]
    .filter((path) => !available.has(path))
    .map(
      (path) =>
        `client code requires "${path}", which the DSH web client does not provide; ` +
        'bundle it, use a type-only import, or list it in dsh.client.external',
    );
}

/** Standalone programs run outside DSH, so they may only import Node built-ins. */
function findNonBuiltinImports(metafile: Metafile, programName: string): string[] {
  return [...new Set(externalImports(metafile))]
    .filter((path) => !path.startsWith('node:'))
    .map((path) => `node program "${programName}" imports "${path}" without bundling it`);
}

function externalImports(metafile: Metafile): string[] {
  return Object.values(metafile.outputs).flatMap((output) =>
    output.imports.filter((entry) => entry.external).map((entry) => entry.path),
  );
}

async function writeOutput(packageDir: string, file: string, content: string): Promise<void> {
  const path = join(packageDir, file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

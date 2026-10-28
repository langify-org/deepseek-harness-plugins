import type { ExportPath } from './declaration.ts';

/**
 * Where build outputs live inside a plugin package. `package.json` refers to these
 * paths, and the manifest check holds it to them.
 */
export const DIST_DIR = 'dist';
export const HOST_PLUGIN_DIR = 'dist/host';
export const CLIENT_MODULE_FILE = 'dist/client.js';
export const BUNDLE_PATCH_FILE = 'dist/cordis.patch.yml';
export const NODE_PROGRAM_DIR = 'dist/bin';

/** Name of a host plugin's output file, without the extension: `index` for the package root. */
export function hostPluginName(exportPath: ExportPath): string {
  return exportPath === '.' ? 'index' : exportPath.slice('./'.length);
}

export function hostPluginFile(exportPath: ExportPath): string {
  return `${HOST_PLUGIN_DIR}/${hostPluginName(exportPath)}.js`;
}

export function nodeProgramFile(name: string): string {
  return `${NODE_PROGRAM_DIR}/${name}.js`;
}

/** The form `package.json` uses for a file inside the package: `./<path>`. */
export function packageRelative(path: string): string {
  return `./${path}`;
}

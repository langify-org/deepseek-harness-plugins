import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import packageJson from '../../../package.json' with { type: 'json' };

/** The plugin's package name and version, as published in its package.json. */
export const PLUGIN_NAME: string = packageJson.name;
export const PLUGIN_VERSION: string = packageJson.version;

/**
 * The built files shipped in the package. The plugin resolves its own package by
 * name rather than from `import.meta.url`, because bundling moves shared code into
 * chunk files at other depths.
 */
export function packageDistDir(): string {
  const manifest = fileURLToPath(import.meta.resolve(`${PLUGIN_NAME}/package.json`));
  return join(dirname(manifest), 'dist');
}

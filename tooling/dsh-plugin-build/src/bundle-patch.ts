import type { HostPluginDeclaration } from './declaration.ts';

/**
 * Renders the bundle patch DSH applies when the package is listed in a profile's
 * bundles: one Loader row per host plugin, inserted at the profile root.
 *
 * Scalars are written as JSON strings, which YAML reads verbatim, so package names
 * starting with `@` need no further quoting rules.
 */
export function renderBundlePatch(
  packageName: string,
  hostPlugins: readonly HostPluginDeclaration[],
): string {
  const rows = hostPlugins.map((plugin) => {
    const specifier =
      plugin.exportPath === '.' ? packageName : `${packageName}/${plugin.exportPath.slice(2)}`;
    return `    - id: ${JSON.stringify(plugin.id)}\n      name: ${JSON.stringify(specifier)}\n`;
  });
  return [
    `# Generated from build.ts by @langify-org/dsh-plugin-build. Do not edit.\n`,
    `- insert:\n`,
    ...rows,
  ].join('');
}

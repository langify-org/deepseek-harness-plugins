/**
 * The DSH web client loads plugin browser code as module factories: executing a
 * bundle only registers `factory` under the package name, and the shell runs the
 * factory on first use with a `require` that resolves shared modules.
 *
 * A plugin bundle is CommonJS wrapped in that registration call.
 */
export function clientModuleBanner(packageName: string): string {
  return `window.__ModuleLoader__.load({id:${JSON.stringify(packageName)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`;
}

export const CLIENT_MODULE_FOOTER = 'return module.exports;}});';

/**
 * Modules every DSH web client provides to plugin bundles (the shell's frozen
 * shared-module table). A bundle may also require modules its package lists in
 * `dsh.client.external`; anything else fails at runtime, so the build rejects it.
 *
 * Source: the `PLATFORM_MODULES` table of `@deepseek-ai/dsh-web-frontend` 0.2.1-rc.2.
 */
export const PLATFORM_MODULES: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

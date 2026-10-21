export { buildPlugin, PluginBuildError } from './build-plugin.ts';
export { renderBundlePatch } from './bundle-patch.ts';
export { CLIENT_MODULE_FOOTER, clientModuleBanner, PLATFORM_MODULES } from './client-module.ts';
export type {
  ClientModuleDeclaration,
  ExportPath,
  HostPluginDeclaration,
  NodeProgramDeclaration,
  PluginBuildDeclaration,
} from './declaration.ts';
export {
  BUNDLE_PATCH_FILE,
  CLIENT_MODULE_FILE,
  hostPluginFile,
  nodeProgramFile,
} from './layout.ts';
export { findManifestProblems, type PluginManifest, readPluginManifest } from './manifest.ts';

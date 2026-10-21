/**
 * What a plugin package builds. Each package states this once, in its `build.ts`.
 *
 * DSH mounts every host plugin as one Loader row named by a package specifier
 * (`<package>` or `<package>/<subpath>`). It serves a package's browser module only
 * when some Loader row names the bare package, so a package with a client module
 * must declare a host plugin at the export path `.`.
 */
export interface PluginBuildDeclaration {
  /** Absolute path of the package directory, the one holding `package.json`. */
  readonly packageDir: string;
  /** Host-side Cordis plugins, each mounted by DSH as one Loader row. */
  readonly hostPlugins: readonly HostPluginDeclaration[];
  /** The browser half served to the DSH web client, if the package has one. */
  readonly clientModule?: ClientModuleDeclaration;
  /** Standalone Node programs shipped in the package and launched by other processes. */
  readonly nodePrograms?: readonly NodeProgramDeclaration[];
  /**
   * Modules that bundled host code requires only if they are installed, such as the
   * optional native accelerators of `ws`. They stay runtime requires.
   */
  readonly optionalHostModules?: readonly string[];
}

/** A package export path: `.` for the package root, `./<name>` for a subpath. */
export type ExportPath = '.' | `./${string}`;

export interface HostPluginDeclaration {
  /** Loader row id written to the bundle patch. It must be unique within a DSH profile. */
  readonly id: string;
  /** Package export that resolves to the plugin module. */
  readonly exportPath: ExportPath;
  /** Plugin module source, relative to the package directory. */
  readonly source: string;
}

export interface ClientModuleDeclaration {
  /** Client module source, relative to the package directory. */
  readonly source: string;
}

export interface NodeProgramDeclaration {
  /** Program name; the program is written to `dist/bin/<name>.js`. */
  readonly name: string;
  /** Program source, relative to the package directory. */
  readonly source: string;
}

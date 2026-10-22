import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DshDevError } from './errors.ts';
import { jsonField, readJsonFile } from './json-files.ts';
import { compareVersions } from './versions.ts';

/**
 * A DSH installation to run the development DSH on: the `dsh` command and the Node.js and
 * pnpm that DSH ships with it.
 *
 * DSH needs its own Node.js: it reaches Node's internals (`--expose-internals`) through a
 * native addon that finds them only in the official Node.js build. And its plugin commands
 * run pnpm from PATH, so the development DSH is handed the pnpm DSH ships.
 */
export interface DshRuntime {
  /** The DSH release, such as `0.2.1-rc.2`. */
  readonly version: string;
  /** The installation's resources directory, where the parts below are found. */
  readonly resourcesDir: string;
  /** The Node.js executable. */
  readonly node: string;
  /** What DSH needs Node.js to be started with. */
  readonly nodeOptions: readonly string[];
  /** The `dsh` command's entry module. */
  readonly cli: string;
  /** pnpm's entry module, for Node.js to run. */
  readonly pnpm: string;
}

/** Where the parts are in a DSH Desktop installation's resources directory. */
const NODE = ['runtime', 'primary-runtime', 'dependencies', 'node', 'bin', 'node'];
const PNPM = ['runtime', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'];
const DSH_PACKAGE = ['app', 'dsh', 'node_modules', '@deepseek-ai', 'dsh'];

/** Set by a developer: the resources directory of the DSH installation to use. */
export const DSH_RUNTIME_ENV = 'DSH_RUNTIME';
/** Set by DSH Desktop for the processes it starts, such as its terminal's. */
const DESKTOP_RESOURCES_ENV = 'DSH_DESKTOP_RESOURCES_PATH';
/** The Linux Desktop's AppImage, as Nix's `appimageTools.extractType2` unpacks it. */
const NIX_EXTRACTED_DESKTOP = /^[0-9a-z]{32}-deepseek-harness-desktop-.+-extracted$/;

export class DshRuntimeError extends DshDevError {}

export interface DshRuntimeSearch {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The Nix store to look in for an unpacked DSH Desktop. */
  readonly nixStore?: string;
}

/**
 * Finds the DSH installation to use: the one `DSH_RUNTIME` names, else the DSH Desktop
 * this process runs under, else the newest DSH Desktop unpacked in the Nix store.
 * @throws DshRuntimeError when `DSH_RUNTIME` names no installation, or none is found.
 */
export async function findDshRuntime(search: DshRuntimeSearch): Promise<DshRuntime> {
  const named = search.env[DSH_RUNTIME_ENV];
  if (named !== undefined && named !== '') {
    const runtime = await readDshRuntime(named);
    if (runtime === undefined) {
      throw new DshRuntimeError(
        `${DSH_RUNTIME_ENV}=${named} is not a DSH installation's resources directory`,
      );
    }
    return runtime;
  }
  const desktop = search.env[DESKTOP_RESOURCES_ENV];
  const fromDesktop = desktop === undefined ? undefined : await readDshRuntime(desktop);
  if (fromDesktop !== undefined) return fromDesktop;
  const fromStore = await newestInNixStore(search.nixStore ?? '/nix/store');
  if (fromStore !== undefined) return fromStore;
  throw new DshRuntimeError(
    'no DSH installation found. Install DSH Desktop, or set ' +
      `${DSH_RUNTIME_ENV} to the resources directory of one ` +
      `(the directory holding ${join(...DSH_PACKAGE)})`,
  );
}

/** The installation in a resources directory, or `undefined` if there is none. */
export async function readDshRuntime(resourcesDir: string): Promise<DshRuntime | undefined> {
  const packageDir = join(resourcesDir, ...DSH_PACKAGE);
  // Whatever is there, it is no installation unless its manifest says so.
  const manifest = await readJsonFile(join(packageDir, 'package.json')).catch(() => undefined);
  const version = jsonField(manifest, 'version');
  const bin = jsonField(jsonField(manifest, 'bin'), 'dsh');
  if (typeof version !== 'string' || typeof bin !== 'string') return undefined;
  const runtime: DshRuntime = {
    version,
    resourcesDir,
    node: join(resourcesDir, ...NODE),
    nodeOptions: ['--expose-internals'],
    cli: join(packageDir, bin),
    pnpm: join(resourcesDir, ...PNPM),
  };
  const present = await Promise.all(
    [runtime.node, runtime.cli, runtime.pnpm].map((path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    ),
  );
  return present.every(Boolean) ? runtime : undefined;
}

async function newestInNixStore(store: string): Promise<DshRuntime | undefined> {
  const entries = await readdir(store).catch((): string[] => []);
  const found = await Promise.all(
    entries
      .filter((entry) => NIX_EXTRACTED_DESKTOP.test(entry))
      .map((entry) => readDshRuntime(join(store, entry, 'resources'))),
  );
  return found
    .filter((runtime): runtime is DshRuntime => runtime !== undefined)
    .sort((a, b) => compareVersions(b.version, a.version))[0];
}

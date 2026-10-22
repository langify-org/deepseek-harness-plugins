#!/usr/bin/env node
/**
 * dsh-dev: runs a development DeepSeek Harness with the workspace's plugins installed,
 * in a home of its own (`.dsh-home`), so that the DSH one uses every day is left alone.
 */
import { access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DevHome } from './dev-home.ts';
import { type DshRuntime, findDshRuntime } from './dsh-runtime.ts';
import { DshDevError } from './errors.ts';
import { packPlugin, prunePacks } from './plugin-packs.ts';
import { run, runForeground } from './processes.ts';
import { installedDependencies, planProfileSync } from './profile-sync.ts';
import { workspacePlugins } from './workspace-plugins.ts';

const USAGE = `Usage: dsh-dev <command> [arguments]

Runs a development DSH, with this workspace's plugins installed, in .dsh-home.

Commands:
  start [web options]  Build and install the plugins, then serve DSH's web UI.
                       Options go to \`dsh web\` (see: dsh-dev dsh web --help),
                       such as --port 3390 or --no-open.
  install              Build the plugins and install them, without starting DSH.
  dsh <arguments>      Run the development DSH's own \`dsh\` command,
                       such as: dsh-dev dsh plugin --profile web list

The DSH it runs is DSH Desktop's, found by itself, or the installation whose resources
directory DSH_RUNTIME names.`;

/** The repository dsh-dev belongs to: it lives in its `tooling/dsh-dev/src`. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

async function main(args: readonly string[]): Promise<number> {
  if (process.platform === 'win32') {
    report('dsh-dev runs on Linux and macOS');
    return 1;
  }
  const [command, ...rest] = args;
  switch (command) {
    case 'start':
      return start(rest);
    case 'install':
      await install(await prepare());
      return 0;
    case 'dsh':
      return dsh(await prepare(), rest);
    case undefined:
    case '-h':
    case '--help':
      console.log(USAGE);
      return 0;
    default:
      console.error(`dsh-dev: unknown command ${command}\n\n${USAGE}`);
      return 2;
  }
}

interface Session {
  readonly runtime: DshRuntime;
  readonly home: DevHome;
}

async function prepare(): Promise<Session> {
  const installed = await access(join(REPOSITORY_ROOT, 'node_modules')).then(
    () => true,
    () => false,
  );
  if (!installed) throw new DshDevError('the workspace is not installed yet: run pnpm install');
  const runtime = await findDshRuntime({ env: process.env });
  const home = DevHome.of(REPOSITORY_ROOT);
  await home.prepare(runtime);
  report(`DSH ${runtime.version} from ${runtime.resourcesDir}, home ${shown(home.root)}`);
  return { runtime, home };
}

async function start(webOptions: readonly string[]): Promise<number> {
  const session = await prepare();
  await install(session);
  report('starting DSH; stop it with Ctrl+C');
  return dsh(session, ['web', ...webOptions]);
}

/** Builds and packs every workspace plugin, and makes them the profile's workspace plugins. */
async function install({ runtime, home }: Session): Promise<void> {
  const plugins = await workspacePlugins(REPOSITORY_ROOT);
  const packs = [];
  for (const plugin of plugins) {
    report(`building ${plugin.name} ${plugin.version}`);
    packs.push(await packPlugin(plugin, home.packagesDir));
  }
  const sync = planProfileSync(
    await installedDependencies(home.profileDir),
    packs,
    home.packagesDir,
  );
  const plugin = (...args: string[]) =>
    runDsh(runtime, home, ['plugin', '--profile', home.profile, ...args]);
  if (sync.remove.length > 0) await plugin('remove', ...sync.remove);
  if (sync.add.length > 0) await plugin('add', ...sync.add);
  if (sync.add.length + sync.remove.length === 0) report('the installed plugins are up to date');
  await prunePacks(home.packagesDir, new Set(packs.map((pack) => pack.path)));
}

/** Runs the development DSH's `dsh` command in the foreground, from where dsh-dev was started. */
function dsh({ runtime, home }: Session, args: readonly string[]): Promise<number> {
  return runForeground(runtime.node, [...runtime.nodeOptions, runtime.cli, ...args], {
    // pnpm runs scripts in the package directory; INIT_CWD is where it was invoked, which
    // DSH takes as its default workspace.
    cwd: process.env['INIT_CWD'] ?? process.cwd(),
    env: home.environment(process.env),
  });
}

function runDsh(runtime: DshRuntime, home: DevHome, args: readonly string[]): Promise<void> {
  return run(runtime.node, [...runtime.nodeOptions, runtime.cli, ...args], {
    cwd: REPOSITORY_ROOT,
    env: home.environment(process.env),
  });
}

function report(message: string): void {
  console.error(`dsh-dev: ${message}`);
}

function shown(path: string): string {
  return relative(process.env['INIT_CWD'] ?? process.cwd(), path) || '.';
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  // A failure dsh-dev explains is reported as such; anything else is a bug, with its stack.
  if (error instanceof DshDevError) report(error.message);
  else console.error(error);
  process.exitCode = 1;
}

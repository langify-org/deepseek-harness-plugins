// Runs DSH Web from an isolated home (.dsh/) with every plugin package linked.
// tsdown rebuilds on change and DSH's HMR reloads the rebuilt plugins.
// A package's dev.patch.yml, when present, overlays its development-only settings.
// Extra arguments go to `dsh web`, e.g. `pnpm dev --port 3081`.
// Only one runs at a time: two would share .dsh/, the builds, and the
// directories a package's dev.patch.yml points at.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginPackages, root } from './plugins.ts'

const home = join(root, '.dsh')
const env = { ...process.env, DSH_HOME: home }
const plugins = pluginPackages()

mkdirSync(home, { recursive: true })
const lock = join(home, 'dev.pid')
if (!acquire(lock)) {
  console.error(`pnpm dev is already running (pid ${readFileSync(lock, 'utf8')}).`)
  process.exit(1)
}
process.on('exit', () => rmSync(lock, { force: true }))

execFileSync('pnpm', ['run', 'build'], { cwd: root, stdio: 'inherit' })
for (const { dir } of plugins) {
  execFileSync('dsh', ['plugin', '--profile', 'web', 'add', `link:${dir}`], {
    env,
    stdio: 'inherit',
  })
}

const hmrPatch = join(home, 'dev.patch.yml')
const watched = plugins.map(({ dir }) => `      - ${JSON.stringify(join(dir, 'dist'))}\n`)
writeFileSync(hmrPatch, `- id: hmr\n  config:\n    root:\n${watched.join('')}`)
const patches = [
  hmrPatch,
  ...plugins.map(({ dir }) => join(dir, 'dev.patch.yml')).filter(existsSync),
]

const children: ChildProcess[] = [
  spawn('pnpm', ['--filter', './packages/*', '--parallel', 'exec', 'tsdown', '--watch'], {
    cwd: root,
    stdio: 'inherit',
  }),
  spawn(
    'dsh',
    ['web', ...patches.flatMap((patch) => ['--patch', patch]), ...process.argv.slice(2)],
    {
      env,
      stdio: 'inherit',
    },
  ),
]
for (const child of children) {
  child.on('exit', (code) => {
    process.exitCode ??= code ?? 1
    for (const other of children) other.kill()
  })
}
// Stop the children and let their exit end this process, which releases the lock.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    for (const child of children) child.kill(signal)
  })
}

/** Create the lock file, replacing one whose process has ended. */
function acquire(path: string): boolean {
  try {
    writeFileSync(path, String(process.pid), { flag: 'wx' })
    return true
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
  }
  if (running(Number(readFileSync(path, 'utf8')))) return false
  rmSync(path)
  return acquire(path)
}

function running(pid: number): boolean {
  // An empty or damaged lock names no process; 0 would mean this process group.
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

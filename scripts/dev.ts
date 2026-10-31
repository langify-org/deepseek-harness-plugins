// Runs DSH Web from an isolated home (.dsh/) with every plugin package linked.
// tsdown rebuilds on change and DSH's HMR reloads the rebuilt plugins.
// A package's dev.patch.yml, when present, overlays its development-only settings.
// Extra arguments go to `dsh web`, e.g. `pnpm dev --port 3081`.
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pluginPackages, root } from './plugins.ts'

const home = join(root, '.dsh')
const env = { ...process.env, DSH_HOME: home }
const plugins = pluginPackages()

mkdirSync(home, { recursive: true })
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

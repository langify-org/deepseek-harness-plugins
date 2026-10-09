#!/usr/bin/env node
/**
 * End-to-end check of @langify-org/dsh-session-hooks against a real `dsh`.
 *
 * Everything runs in a throwaway DSH home and a throwaway git repository; your
 * own profiles, sessions, and running DSH are never touched.
 *
 *   1. compose  — the plugin row composes, with its entry resolved to the bundle.
 *   2. archive  — a Web profile on a free port, with ./driver.mjs creating,
 *                 archiving, and restoring a session through DSH's own APIs; the
 *                 bundle's worktree examples run as the configured hooks, and the
 *                 project's own .dsh/hooks.yml (trusted) runs after them.
 *   3. context  — only with DSH_E2E_PROVIDER_PATCH: a headless run asks the model
 *                 for the workdir the start hook announced (one model request).
 *
 * The bundle under test is, in order of precedence:
 *   DSH_E2E_TARBALL=<.tgz>      installed into the throwaway profiles with `dsh plugin add`
 *   DSH_E2E_PLUGIN_PATCH=<file> loaded with --patch from another build (e.g. the Nix one)
 *   (default)                   loaded with --patch from this checkout
 *
 * Usage: pnpm run build && node e2e/session-hooks/run.mjs
 * Env:   DSH_BIN (default `dsh`), DSH_E2E_PROVIDER_PATCH (a patch with your model
 *        provider rows, e.g. ~/.dsh/profiles/web/cordis.patch.yml), DSH_E2E_KEEP=1.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE = '@langify-org/dsh-session-hooks'
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const dsh = process.env.DSH_BIN ?? 'dsh'
const providerPatch = process.env.DSH_E2E_PROVIDER_PATCH
const tarball = process.env.DSH_E2E_TARBALL && resolve(process.env.DSH_E2E_TARBALL)

const root = mkdtempSync(join(tmpdir(), 'langify-dsh-e2e-'))
const home = join(root, 'home')
const project = join(root, 'project')
const worktrees = join(root, 'worktrees')
const records = join(root, 'records')
const state = join(root, 'state')
const hooksPatch = join(root, 'hooks.patch.yml')
const children = new Set()
let failed = false
// The child dsh must not inherit the facts of a DSH session this script may run in.
const dshEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DSH_')))
dshEnv.DSH_HOME = home
dshEnv.DSH_TELEMETRY_DISABLED = '1'

/** Where the bundle under test lives, and which --patch files load it. */
const bundle = tarball
  ? { label: `installed from ${tarball}`, dir: join(home, 'profiles', 'web', 'node_modules', PACKAGE), patches: [] }
  : process.env.DSH_E2E_PLUGIN_PATCH
    ? { label: 'another build, via --patch', dir: dirname(resolve(process.env.DSH_E2E_PLUGIN_PATCH)) }
    : { label: 'this checkout, via --patch', dir: join(repoRoot, 'plugins', 'session-hooks') }
bundle.patches ??= [join(bundle.dir, 'cordis.patch.yml')]

const sh = (value) => `'${value.replaceAll("'", `'\\''`)}'`
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const git = (...args) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8' }).trim()
const run = (args, options = {}) => execFileSync(dsh, args, { cwd: project, env: dshEnv, encoding: 'utf8', ...options })

function step(title) {
  console.log(`\n== ${title}`)
}
function check(condition, message) {
  if (!condition) throw new Error(`check failed: ${message}`)
  console.log(`  ok  ${message}`)
}

function setup() {
  console.log(`bundle: ${bundle.label}`)
  for (const dir of [home, project, worktrees, records]) mkdirSync(dir, { recursive: true })
  if (tarball) {
    for (const profile of ['web', 'headless']) run(['plugin', '--profile', profile, 'add', tarball], { cwd: root, stdio: 'inherit' })
  }
  if (!existsSync(join(bundle.dir, 'lib', 'index.js'))) throw new Error(`no built bundle at ${bundle.dir} (run pnpm run build)`)

  git('init', '-q', '-b', 'main')
  writeFileSync(join(project, 'README.md'), '# e2e\n')
  git('add', 'README.md')
  git('-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', 'commit', '-q', '-m', 'init')
  // The project's own hooks file, with inline scripts; trusted below through projectHooks.trustedDirs.
  const projectRecord = (event, suffix) => `${sh(join(records, `project-${event}-`))}"$DSH_SESSION_ID".${suffix}`
  mkdirSync(join(project, '.dsh'), { recursive: true })
  writeFileSync(
    join(project, '.dsh', 'hooks.yml'),
    [
      'sessionStart:',
      '  - |',
      `    cat > ${projectRecord('start', 'json')}`,
      `    pwd > ${projectRecord('start', 'pwd')}`,
      'sessionArchive:',
      `  - cat > ${projectRecord('archive', 'json')}`,
      '',
    ].join('\n'),
  )

  const examples = join(bundle.dir, 'examples')
  const env = `DSH_WORKTREES_DIR=${sh(worktrees)}`
  const record = (event) => `tee ${sh(join(records, `${event}-`))}"$DSH_SESSION_ID.json"`
  // `bash <script>`: package managers do not keep the executable bit on non-bin files.
  const hook = (event, script) => `${record(event)} | ${env} bash ${sh(join(examples, script))}`
  // YAML is a superset of JSON, so a JSON array is a valid patch file.
  writeFileSync(
    hooksPatch,
    JSON.stringify([
      {
        id: 'langify-session-hooks',
        config: {
          stateDir: state,
          projectHooks: { trustedDirs: [root] },
          sessionStart: [hook('start', 'worktree-start.sh')],
          sessionArchive: [hook('archive', 'worktree-archive.sh')],
          sessionUnarchive: [hook('unarchive', 'worktree-unarchive.sh')],
        },
      },
    ]),
  )
}

function compose() {
  step('compose: the plugin row resolves to the bundle')
  const patches = [...bundle.patches, hooksPatch].flatMap((patch) => ['--patch', patch])
  const dump = run(['web', ...patches, '--dump-config'])
  check(dump.includes('- id: langify-session-hooks'), 'the row is in the composed tree')
  const entry = tarball ? PACKAGE : pathToFileURL(join(bundle.dir, 'lib', 'index.js')).href
  check(dump.includes(entry), `the entry is ${entry}`)
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => done(port))
    })
  })
}

async function waitForFile(file, timeoutMs, describe, child) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(file)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`dsh exited before ${describe}`)
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${describe}`)
    await new Promise((r) => setTimeout(r, 250))
  }
}

async function archive() {
  step('archive: create, archive, and restore a session in a Web profile')
  const port = await freePort()
  const doneFile = join(root, 'driver-done.json')
  const driverPatch = join(root, 'driver.patch.yml')
  writeFileSync(
    driverPatch,
    JSON.stringify([{ insert: [{ id: 'langify-e2e-driver', name: join(here, 'driver.mjs'), config: { doneFile, cwd: project } }] }]),
  )
  const patches = [...(providerPatch ? [providerPatch] : []), ...bundle.patches, hooksPatch, driverPatch]
  const log = join(root, 'web.log')
  const out = openSync(log, 'w')
  // Launcher flags (--patch) come before the first app flag (--port).
  const args = ['web', ...patches.flatMap((p) => ['--patch', p]), '--port', String(port), '--no-open']
  const child = spawn(dsh, args, { cwd: project, env: dshEnv, stdio: ['ignore', out, out] })
  children.add(child)
  try {
    await waitForFile(doneFile, 120_000, `the driver finished (log: ${log})`, child)
    const done = readJson(doneFile)
    if (!done.ok) throw new Error(`driver failed: ${done.error}`)
    const id = done.sessionId
    const start = readJson(join(records, `start-${id}.json`))
    check(start.hook_event_name === 'SessionStart' && start.source === 'startup' && start.cwd === project, 'start hook ran for the new session')
    const worktree = join(worktrees, 'project', id)
    const archived = readJson(join(records, `archive-${id}.json`))
    check(archived.hook_event_name === 'SessionArchive' && archived.workdir === worktree, 'archive hook got the recorded workdir')
    const restored = readJson(join(records, `unarchive-${id}.json`))
    check(restored.hook_event_name === 'SessionUnarchive' && restored.workdir === worktree, 'unarchive hook got the recorded workdir')
    check(existsSync(join(worktree, 'README.md')), 'the worktree exists again after unarchive')
    check(git('branch', '--list', `dsh/${id}`) !== '', `branch dsh/${id} was kept`)
    const projectStart = readJson(join(records, `project-start-${id}.json`))
    check(projectStart.workdir === worktree, 'the project hooks file ran after the configured hook, with its workdir')
    check(readFileSync(join(records, `project-start-${id}.pwd`), 'utf8').trim() === project, 'project hooks run in the project root')
    check(readJson(join(records, `project-archive-${id}.json`)).hook_event_name === 'SessionArchive', 'the project archive hook ran')
    const runs = readFileSync(join(state, 'hooks.log'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const runOf = (event) => runs.find((entry) => entry.event === event && entry.sessionId === id && entry.hooks === 'config')
    check(runs.every((entry) => entry.status === 'ok'), 'every hook run succeeded (hooks.log)')
    check(runOf('SessionArchive')?.stderr.includes(`removed worktree ${worktree}`), 'archive example removed the clean worktree')
    check(runOf('SessionUnarchive')?.stderr.includes(`restored worktree ${worktree}`), 'unarchive example restored it')
    check(!readFileSync(log, 'utf8').includes('[langify-session-hooks]'), 'no warnings on dsh stderr')
  } finally {
    await stop(child)
  }
}

function context() {
  step('context: the model is told about the workdir (one model request)')
  if (!providerPatch) {
    console.log('  skip: set DSH_E2E_PROVIDER_PATCH to a patch with your model provider rows')
    return
  }
  const prompt =
    'Do not run any tools. Reply with exactly one line: the absolute path of the working directory you were told to use for this session.'
  const patches = [providerPatch, ...bundle.patches, hooksPatch].flatMap((patch) => ['--patch', patch])
  const answer = run(['headless', ...patches, prompt], { timeout: 180_000 })
  const created = readdirSync(join(worktrees, 'project')).map((id) => join(worktrees, 'project', id))
  console.log(`  answer: ${answer.trim()}`)
  check(created.some((path) => answer.includes(path)), 'the answer names the worktree the start hook created')
}

function stop(child) {
  return new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      children.delete(child)
      return done()
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000)
    child.once('exit', () => {
      clearTimeout(timer)
      children.delete(child)
      done()
    })
    child.kill('SIGTERM')
  })
}

try {
  setup()
  compose()
  await archive()
  context()
  console.log('\nE2E passed')
} catch (error) {
  failed = true
  console.error(`\nE2E failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  for (const child of children) await stop(child)
  if (process.env.DSH_E2E_KEEP === '1' || failed) console.log(`kept ${root}`)
  else rmSync(root, { recursive: true, force: true })
  process.exitCode = failed ? 1 : 0
}

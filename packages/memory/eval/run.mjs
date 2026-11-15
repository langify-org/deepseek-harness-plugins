#!/usr/bin/env node
// Evaluation runner: plays each case in a throwaway DSH home with a real model and grades it.
//
//   node packages/memory/eval/run.mjs [--plugin <dir>] [--cases <dir>] [--case <name>]... [--runs 3]
//
// A case (cases/*.json) is a memory to start from, a script for the probe (probe/index.js), and
// checks on the answers, on the memory directory afterwards, and on who wrote to it. A check is a
// pattern, or a question that a model answers yes or no about the text (`judge`), asked in a home
// without the memory plugin. The cases in this repository are invented; cases made from real
// conversations stay outside it (--cases).
//
// MEMORY_EVAL_PROFILE  a file appended to the home's profile patch: the LLM provider and models,
//                      the permission mode, and the memory plugin's row with its models.
// MEMORY_EVAL_WRAP     a command put before `dsh`, such as one that supplies the provider's key.
import { execFileSync, spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const { values: args } = parseArgs({
  options: {
    plugin: { type: 'string', default: resolve(here, '..') },
    cases: { type: 'string', default: join(here, 'cases') },
    case: { type: 'string', multiple: true },
    runs: { type: 'string', default: '1' },
    parallel: { type: 'string', default: '4' },
    out: { type: 'string' },
    keep: { type: 'boolean', default: false },
    // Grade the runs saved by an earlier --out again, with the cases as they are now.
    regrade: { type: 'string' },
  },
})
const profile = process.env.MEMORY_EVAL_PROFILE
if (profile === undefined) throw new Error('set MEMORY_EVAL_PROFILE to a profile patch fragment')
const wrap = (process.env.MEMORY_EVAL_WRAP ?? '').split(' ').filter((word) => word !== '')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Every Markdown file under `directory`, by its path relative to it. */
function notes(directory, base = directory, found = {}) {
  if (!existsSync(directory)) return found
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== '.git') notes(path, base, found)
    } else if (entry.name.endsWith('.md')) {
      found[relative(base, path)] = readFileSync(path, 'utf8')
    }
  }
  return found
}

/** Stop every process started with `home` as its DSH home. */
function stop(child, home) {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
  for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    try {
      const environment = readFileSync(`/proc/${pid}/environ`, 'utf8')
      if (environment.split('\0').includes(`DSH_HOME=${home}`)) process.kill(Number(pid), 'SIGTERM')
    } catch {
      // Not ours to read, or gone.
    }
  }
}

/** Play one case once and return the probe's result with the memory directory as it was left. */
async function play(example, bundles = [args.plugin, join(here, 'probe')]) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-memory-eval-'))
  const env = { ...process.env, DSH_HOME: home }
  try {
    // A directory to start the home from: `memory` in it is the memory directory, `storages` what the plugin stored.
    if (example.homeFrom !== undefined) cpSync(example.homeFrom, home, { recursive: true })
    if (example.memoryFrom !== undefined) {
      cpSync(example.memoryFrom, join(home, 'memory'), { recursive: true })
    }
    const fixture =
      example.fixture === undefined
        ? {}
        : JSON.parse(readFileSync(join(here, 'fixtures', `${example.fixture}.json`), 'utf8'))
    for (const [path, content] of Object.entries({ ...fixture, ...example.memory })) {
      mkdirSync(dirname(join(home, 'memory', path)), { recursive: true })
      writeFileSync(join(home, 'memory', path), content)
    }
    writeFileSync(join(home, 'script.json'), JSON.stringify({ steps: example.steps }))
    for (const bundle of bundles) {
      execFileSync('dsh', ['plugin', '--profile', 'web', 'add', `link:${bundle}`], {
        env,
        stdio: 'pipe',
      })
    }
    const patch = join(home, 'profiles', 'web', 'cordis.patch.yml')
    writeFileSync(
      patch,
      readFileSync(patch, 'utf8').replace(/^\[\]\n/m, '') + readFileSync(profile, 'utf8'),
    )
    const log = openSync(join(home, 'dsh.log'), 'w')
    const [command, ...rest] = [...wrap, 'dsh', '--profile', 'web', '--no-open', '--port', '0']
    const child = spawn(command, rest, {
      env,
      cwd: home,
      detached: true,
      stdio: ['ignore', log, log],
    })
    const until = Date.now() + (example.minutes ?? 30) * 60_000
    let result
    while (Date.now() < until) {
      await sleep(2000)
      const file = join(home, 'result.json')
      if (!existsSync(file)) continue
      try {
        result = JSON.parse(readFileSync(file, 'utf8'))
      } catch {
        continue
      }
      if (result.done === true) break
    }
    stop(child, home)
    await sleep(1500)
    if (result?.done !== true) {
      const tail = readFileSync(join(home, 'dsh.log'), 'utf8').split('\n').slice(-8).join('\n')
      result = {
        ...result,
        turns: result?.turns ?? [],
        answers: result?.answers ?? {},
        error: `no result in time\n${tail}`,
      }
    }
    return {
      ...result,
      notes: notes(join(home, 'memory')),
      kept: notes(`${join(home, 'memory')}-transcripts`),
    }
  } finally {
    if (!args.keep) rmSync(home, { recursive: true, force: true })
    else console.error(`kept ${home}`)
  }
}

/** A day as people write it in notes, `offset` days from today: 11/16. */
function dayText(offset) {
  const day = new Date(Date.now() + offset * 86_400_000)
  return `${day.getMonth() + 1}/${day.getDate()}`
}
/** A day as a directory of episodes is named, `offset` days from today: 2026-09-16. */
function dayName(offset) {
  const day = new Date(Date.now() + offset * 86_400_000)
  const month = String(day.getMonth() + 1).padStart(2, '0')
  return `${day.getFullYear()}-${month}-${String(day.getDate()).padStart(2, '0')}`
}
/** A case with {{today}}, {{tomorrow}}, {{yesterday}} and {{long-ago}} (a day's name, 60 days back) filled in. */
const dated = (example) =>
  JSON.parse(
    JSON.stringify(example)
      .replaceAll('{{today}}', dayText(0))
      .replaceAll('{{tomorrow}}', dayText(1))
      .replaceAll('{{yesterday}}', dayText(-1))
      .replaceAll('{{long-ago}}', dayName(-60)),
  )

const matches = (text, patterns) =>
  (patterns ?? []).map((pattern) => new RegExp(pattern, 'iu').test(text))

/** The text a check is about: an answer, or the files of memory whose paths match. */
function subject(check, run) {
  if (check.answer !== undefined) return run.answers[check.answer]?.reply ?? ''
  const path = new RegExp(check.memory, 'u')
  return Object.entries(run.notes ?? {})
    .filter(([name]) => path.test(name))
    .map(([name, content]) => `--- ${name} ---\n${content}`)
    .join('\n')
}

/** One check against one run: true when it holds. `verdict` is the judge's, for a check that has one. */
function holds(check, run, verdict) {
  if (check.judge !== undefined) return verdict === true
  if (check.answer !== undefined || check.memory !== undefined) {
    const text = subject(check, run)
    return matches(text, check.match).every(Boolean) && !matches(text, check.absent).some(Boolean)
  }
  if (check.noMemoryWritesBy !== undefined) {
    return run.turns
      .filter((turn) => turn.kind === check.noMemoryWritesBy)
      .every((turn) => turn.memoryWrites.length === 0)
  }
  throw new Error(`unknown check: ${JSON.stringify(check)}`)
}

/** What a run cost, by who spent it. */
function costs(run) {
  const by = {}
  for (const turn of run.turns) {
    by[turn.kind] ??= { turns: 0, steps: 0, cost: 0, writes: 0 }
    by[turn.kind].turns++
    by[turn.kind].steps += turn.steps
    by[turn.kind].cost += turn.cost
    by[turn.kind].writes += turn.memoryWrites.length
  }
  return by
}

const names = readdirSync(args.cases)
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .filter((name) => args.case === undefined || args.case.includes(name))
const jobs = names.flatMap((name) =>
  Array.from({ length: Number(args.runs) }, (_, run) => ({ name, run })),
)
const examples = Object.fromEntries(
  names.map((name) => [
    name,
    dated(JSON.parse(readFileSync(join(args.cases, `${name}.json`), 'utf8'))),
  ]),
)
const runs = args.regrade === undefined ? {} : JSON.parse(readFileSync(args.regrade, 'utf8')).runs
let next = args.regrade === undefined ? 0 : jobs.length
await Promise.all(
  Array.from({ length: Math.min(Number(args.parallel), jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]
      const run = await play(examples[job.name])
      ;(runs[job.name] ??= []).push(run)
      console.error(
        `${job.name} #${job.run + 1}: ${run.error === undefined ? 'played' : run.error.split('\n')[0]}`,
      )
    }
  }),
)

// The judged checks, asked together in one home that has no memory plugin.
const asked = names.flatMap((name) =>
  (runs[name] ?? []).flatMap((run, index) =>
    examples[name].checks.flatMap((check, at) =>
      check.judge === undefined || run.error !== undefined
        ? []
        : [{ key: `${name}#${index}#${at}`, text: subject(check, run), question: check.judge }],
    ),
  ),
)
const verdicts = {}
if (asked.length > 0) {
  const judged = await play(
    {
      minutes: 60,
      steps: asked.map(({ key, text, question }) => ({
        do: 'ask',
        key,
        preset: 'minimal',
        text: `You are grading. A text follows, then a question about it. Reply with YES or NO alone on the first line, then one sentence saying why. Use no tools.\n\n=== text ===\n${text}\n\n=== question ===\n${question}`,
      })),
    },
    [join(here, 'probe')],
  )
  for (const { key } of asked) {
    const reply = judged.answers?.[key]?.reply
    verdicts[key] = reply === undefined ? undefined : /^\W*yes\b/iu.test(reply)
  }
  if (judged.error !== undefined) console.error(`judge: ${judged.error.split('\n')[0]}`)
}

const report = {}
for (const name of names) {
  const example = examples[name]
  const played = runs[name] ?? []
  const checks = example.checks.map((check, at) => ({
    name: check.name,
    passed: played.filter(
      (run, index) =>
        run.error === undefined && holds(check, run, verdicts[`${name}#${index}#${at}`]),
    ).length,
  }))
  const spent = played.map(costs)
  const kinds = [...new Set(spent.flatMap((by) => Object.keys(by)))]
  const mean = (kind, field) =>
    Math.round(
      spent.reduce((sum, by) => sum + (by[kind]?.[field] ?? 0), 0) / Math.max(1, spent.length),
    )
  report[name] = {
    runs: played.length,
    errors: played.flatMap((run) => (run.error === undefined ? [] : [run.error])),
    broken: played.flatMap((run) => run.broken ?? []),
    checks,
    cost: Object.fromEntries(
      kinds.map((kind) => [
        kind,
        {
          turns: mean(kind, 'turns'),
          steps: mean(kind, 'steps'),
          cost: mean(kind, 'cost'),
          writes: mean(kind, 'writes'),
        },
      ]),
    ),
    notesBytes: Math.round(
      played.reduce((sum, run) => sum + Object.values(run.notes ?? {}).join('').length, 0) /
        Math.max(1, played.length),
    ),
  }
  console.log(`\n${name} (${played.length} run${played.length === 1 ? '' : 's'})`)
  for (const check of checks) console.log(`  ${check.passed}/${played.length}  ${check.name}`)
  for (const [kind, c] of Object.entries(report[name].cost)) {
    console.log(
      `  cost ${kind}: ${c.cost} in ${c.turns} turn(s), ${c.steps} model call(s), ${c.writes} write(s)`,
    )
  }
  for (const error of report[name].errors) console.log(`  ERROR ${error.split('\n')[0]}`)
  if (report[name].broken.length > 0)
    console.log(`  BROKEN PRESETS ${JSON.stringify(report[name].broken)}`)
}
if (args.out !== undefined) {
  writeFileSync(args.out, JSON.stringify({ plugin: args.plugin, report, verdicts, runs }, null, 1))
}

// Evaluation probe. In a throwaway DSH home it plays $DSH_HOME/script.json (conversations that
// say things, questions put to fresh conversations, files planted in memory, a new memory day)
// and writes what happened to $DSH_HOME/result.json: every turn of every session with its tool
// calls and cost, and the answers to the questions. run.mjs starts DSH with it and grades.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const name = 'memory-eval-probe'
export const inject = ['sessionController', 'agentPresets', 'workspaceRegistry']

/** Cost in units of one uncached input token. */
const cost = (u) =>
  (u.inputTokens ?? 0) +
  0.1 * (u.cacheReadTokens ?? 0) +
  1.25 * (u.cacheWriteTokens ?? 0) +
  5 * (u.outputTokens ?? 0)
const text = (content) =>
  content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const WRITES = new Set(['edit', 'write', 'apply_patch'])

export function apply(ctx) {
  const home = process.env.DSH_HOME
  const memory = join(home, 'memory')
  const script = JSON.parse(readFileSync(join(home, 'script.json'), 'utf8'))
  const result = { turns: [], answers: {}, broken: [], error: undefined, done: false }
  const save = () => writeFileSync(join(home, 'result.json'), JSON.stringify(result, null, 1))

  /** Session id → the label the script gave it. */
  const labels = new Map()
  /** Session id → its turn in progress. */
  const running = new Map()
  /** Session id → how many of its turns ended. */
  const ended = new Map()
  let quietSince = Date.now()
  let holder

  const kindOf = (session) => {
    const cwd = session.header.cwd ?? ''
    const inMemory = cwd === memory || cwd.startsWith(memory + '/')
    const child = session.header.origin === 'subagent'
    if (inMemory) return child ? 'memory-agent' : 'memory-holder'
    return child ? 'subagent' : 'conversation'
  }

  ctx.on('session/event', (session, event) => {
    const id = session.id
    if (event.type === 'turn/start') {
      running.set(id, {
        kind: kindOf(session),
        label: labels.get(id),
        session: id,
        calls: [],
        memoryWrites: [],
        given: [],
        errors: 0,
        steps: 0,
        cost: 0,
        context: 0,
        reply: '',
      })
      return
    }
    const turn = running.get(id)
    if (turn === undefined) return
    if (event.type === 'user/message' && event.data.source.kind.startsWith('langify-memory')) {
      // What the plugin put into the conversation: the index, a notice of changes, recalled lines.
      turn.given.push({
        kind: event.data.source.kind,
        text: text(event.data.content).replaceAll(home, '~').slice(0, 4000),
      })
    } else if (event.type === 'tool/call') {
      turn.calls.push(event.data.name)
      const touchesMemory = event.data.arguments.includes(memory) || turn.kind !== 'conversation'
      if (WRITES.has(event.data.name) && touchesMemory) {
        turn.memoryWrites.push(event.data.arguments.replaceAll(home, '~').slice(0, 300))
      }
    } else if (event.type === 'tool/result') {
      if (event.data.message.isError === true) turn.errors++
    } else if (event.type === 'assistant/message') {
      const usage = event.data.usage ?? {}
      turn.steps++
      turn.cost += cost(usage)
      turn.context = usage.totalTokens ?? turn.context
      const said = text(event.data.message.content).trim()
      if (said !== '') turn.reply = said
    } else if (event.type === 'turn/end') {
      turn.cost = Math.round(turn.cost)
      turn.ended = event.data.reason.kind
      if (turn.kind === 'memory-holder' && turn.ended !== 'blocked') holder = id
      running.delete(id)
      ended.set(id, (ended.get(id) ?? 0) + 1)
      // A step DSH refused is no work: the holder of scribes is told when each one ends.
      if (turn.ended !== 'blocked') result.turns.push(turn)
      quietSince = Date.now()
    }
  })

  /** Wait until no session has had a turn in progress for `quiet` milliseconds. */
  const idle = async (quiet = 6000, limit = 900_000) => {
    const until = Date.now() + limit
    while (Date.now() < until) {
      if (running.size === 0 && Date.now() - quietSince >= quiet) return
      await sleep(300)
    }
    throw new Error('the sessions did not go idle')
  }

  const sessionsByLabel = new Map()
  let requests = 0
  /** Say `words` in the conversation `label`, started on first use, and wait for its turn and for memory to settle. */
  const say = async (label, preset, words) => {
    let sessionId = sessionsByLabel.get(label)
    if (sessionId === undefined) {
      const cwd = join(home, `work-${label}`)
      mkdirSync(cwd, { recursive: true })
      sessionId = (await ctx.sessionController.create({ cwd, agentPreset: preset })).sessionId
      sessionsByLabel.set(label, sessionId)
      labels.set(sessionId, label)
    }
    const before = ended.get(sessionId) ?? 0
    await ctx.sessionController.prompt(
      {
        requestId: `eval-${++requests}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: words }],
      },
      AbortSignal.timeout(30_000),
    )
    const until = Date.now() + 900_000
    while ((ended.get(sessionId) ?? 0) === before) {
      if (Date.now() > until) throw new Error(`the turn of ${label} did not end`)
      await sleep(300)
    }
    await idle()
    return result.turns.findLast((turn) => turn.session === sessionId)
  }

  const play = async () => {
    const presets = await ctx.agentPresets.list()
    result.broken = presets.flatMap((p) => (p.broken === undefined ? [] : [[p.id, p.broken]]))
    for (const step of script.steps) {
      if (step.do === 'say') {
        await say(step.as, step.preset ?? 'minimal', step.text)
      } else if (step.do === 'ask') {
        const turn = await say(`ask-${step.key}`, step.preset ?? 'standard', step.text)
        result.answers[step.key] = turn
      } else if (step.do === 'file') {
        const path = join(memory, step.path)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, step.text)
      } else if (step.do === 'new-day') {
        // DSH runs no subagent of an archived conversation: the next turn that ends starts a new memory day.
        if (holder !== undefined) await ctx.workspaceRegistry.archiveSession(holder)
        await say('eval-clock', 'minimal', 'Reply with only the word: ok')
      } else if (step.do === 'wait') {
        await sleep(step.ms)
      } else {
        throw new Error(`unknown step: ${JSON.stringify(step)}`)
      }
      save()
    }
  }

  const timer = setTimeout(() => {
    play()
      .catch((error) => {
        result.error = String(error?.stack ?? error).slice(0, 2000)
      })
      .finally(() => {
        result.done = true
        save()
      })
  }, 4000)
  ctx.effect(() => () => clearTimeout(timer))
}

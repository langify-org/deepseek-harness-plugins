/**
 * @langify-org/dsh-session-hooks — run shell commands on session lifecycle events.
 *
 * - `sessionStart`: when DSH creates a session (`agent/created`), before its
 *   first model request. A command may print `{"workdir": ..., "context": ...}`;
 *   the plugin tells the model about it, since DSH fixes a session's directory
 *   at creation.
 * - `sessionArchive` / `sessionUnarchive`: after the workspace registry durably
 *   archives or restores a session (detected from `domain/changed`).
 *
 * Commands run with the DSH process's privileges, outside the agent sandbox,
 * like Claude Code hooks. A failing command is logged and never stops DSH.
 */
import { stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-workspace'
import { archivedIdsOf, ArchiveWatcher } from './archive-watch.ts'
import { Config, resolveConfig, type HookCommand, type HookLists, type StartSource } from './config.ts'
import { CONTEXT_SOURCE_KIND, startContext } from './context.ts'
import { parseStartOutput } from './output.ts'
import { hookEnv, hookStdin, type HookEventName, type HookPayload } from './payload.ts'
import { loadProjectHooks } from './project.ts'
import { logEntry, RunLog, type HookOrigin } from './run-log.ts'
import { runCommand, succeeded, type RunResult } from './runner.ts'
import { defaultStateDir, SessionStateStore, STATE_DIR_NAME, type SessionRecord } from './state.ts'
import { KeyedQueue, TaskTracker } from './tasks.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'langify-session-hooks': { kind: 'langify-session-hooks' } & ContextFormed
  }
}

export { Config }
export type { ConfigInput, HookCommand, SessionHooksConfig, StartSource } from './config.ts'
export type { HookEventName, HookPayload } from './payload.ts'

export const name = 'langify-session-hooks'

/** The launcher's startup signal (`@deepseek-ai/dsh-cmdline`), when present. */
interface AppReadyLike {
  onReady(listener: () => void): () => void
}

/** The launcher's Harness-home resolver (`@deepseek-ai/dsh-home-paths`), when present. */
type DshHomePath = (...segments: string[]) => string

/** The hook list each event runs. */
const LIST_KEY = {
  SessionStart: 'sessionStart',
  SessionArchive: 'sessionArchive',
  SessionUnarchive: 'sessionUnarchive',
} as const satisfies Record<HookEventName, keyof HookLists>

/** The outcome of running one event's command list. */
interface ListOutcome {
  readonly workdir: string | null
  readonly contexts: readonly string[]
}

export function apply(ctx: Context, rawConfig?: unknown): void {
  const config = resolveConfig(rawConfig)
  const logger = ctx.logger('langify-session-hooks')
  const dshHomePath = ctx.get('dshHomePath') as DshHomePath | undefined
  const stateDir = config.stateDir ?? (dshHomePath !== undefined ? dshHomePath(STATE_DIR_NAME) : defaultStateDir())
  const store = new SessionStateStore(stateDir)
  const runLog = new RunLog(join(stateDir, 'hooks.log'))
  const queue = new KeyedQueue()
  const tracker = new TaskTracker()
  const lifetime = new AbortController()
  ctx.effect(
    () => async () => {
      lifetime.abort()
      await tracker.drain()
    },
    'langify-session-hooks: stop running hooks',
  )

  const projectHooksOn = config.projectHooks.trustedDirs.length > 0
  /** Projects whose untrusted hooks file was already reported, to report each once. */
  const reportedUntrusted = new Set<string>()

  if (config.sessionStart.length > 0 || projectHooksOn) {
    ctx.on('agent/created', async ({ agent, source, signal }) => {
      const header = agent.session.header
      if (header.origin === 'subagent' && !config.includeSubagents) return
      const run = config.startSources.includes(source)
        ? queue.run(header.id, () => onStart(agent, source, signal))
        : queue.run(header.id, () => restoreNote(agent))
      tracker.track(run)
      await run
    })
  }

  if (config.sessionArchive.length > 0 || config.sessionUnarchive.length > 0 || projectHooksOn) {
    const watcher = new ArchiveWatcher(() => ctx.get('workspaceRegistry')?.archivedSessionIds)
    watcher.prime()
    const appReady = ctx.get('appReady') as AppReadyLike | undefined
    if (appReady !== undefined) {
      ctx.effect(() => appReady.onReady(() => watcher.prime()), 'langify-session-hooks: archive baseline')
    }
    ctx.on('domain/changed', (change) => {
      const ids = archivedIdsOf(change)
      if (ids === undefined) return
      const { archived, unarchived } = watcher.update(ids)
      for (const id of archived) tracker.track(queue.run(id, () => onLifecycle('SessionArchive', id)))
      for (const id of unarchived) tracker.track(queue.run(id, () => onLifecycle('SessionUnarchive', id)))
    })
  }

  async function onStart(agent: Agent, source: StartSource, signal: AbortSignal | undefined): Promise<void> {
    const header = agent.session.header
    const cwd = header.cwd ?? null
    const payload: HookPayload = {
      hook_event_name: 'SessionStart',
      session_id: header.id,
      cwd,
      workdir: null,
      source,
      ...(header.parentSession !== undefined ? { parent_session_id: header.parentSession } : {}),
      ...(header.origin !== undefined ? { origin: header.origin } : {}),
    }
    const runSignal = signal === undefined ? lifetime.signal : AbortSignal.any([signal, lifetime.signal])
    const outcome = await runEvent('SessionStart', payload, runSignal)
    const record: SessionRecord = {
      sessionId: header.id,
      cwd,
      workdir: outcome.workdir,
      contexts: outcome.contexts,
      startedAt: new Date().toISOString(),
    }
    await store.write(record).catch((error: unknown) => {
      warn(`could not record session ${header.id} in ${store.dir}: ${String(error)}`)
    })
    injectNote(agent, record)
  }

  /**
   * A session that starts without running start hooks (by default: resumed,
   * cleared, or compacted) gets the recorded note again when its history does
   * not hold it. DSH discards a note still waiting for the first model request
   * when it stops, and compaction or clearing can drop a delivered one.
   */
  async function restoreNote(agent: Agent): Promise<void> {
    const record = await store.read(agent.session.header.id).catch(() => undefined)
    if (record === undefined || noteInHistory(agent)) return
    injectNote(agent, record)
  }

  function injectNote(agent: Agent, record: SessionRecord): void {
    const note = startContext(record.cwd, record.workdir, record.contexts)
    if (note === undefined) return
    agent.inject(
      createUserMessage({
        content: [{ type: 'text', text: note.text }],
        source: { kind: CONTEXT_SOURCE_KIND, form: 'notice', summary: note.summary },
      }),
    )
  }

  async function onLifecycle(event: 'SessionArchive' | 'SessionUnarchive', sessionId: string): Promise<void> {
    const configured = event === 'SessionArchive' ? config.sessionArchive : config.sessionUnarchive
    if (configured.length === 0 && !projectHooksOn) return
    const facts = await sessionFacts(sessionId)
    if (facts.origin === 'subagent' && !config.includeSubagents) return
    const payload: HookPayload = {
      hook_event_name: event,
      session_id: sessionId,
      cwd: facts.cwd,
      workdir: facts.workdir,
      ...(facts.parentSessionId !== undefined ? { parent_session_id: facts.parentSessionId } : {}),
      ...(facts.origin !== undefined ? { origin: facts.origin } : {}),
    }
    await runEvent(event, payload, lifetime.signal)
  }

  /**
   * Run an event's configured commands in the session directory, then the
   * project's own commands in the project root. The project's commands see the
   * workdir the configured ones chose.
   */
  async function runEvent(event: HookEventName, payload: HookPayload, signal: AbortSignal): Promise<ListOutcome> {
    const key = LIST_KEY[event]
    const configured = await runList(event, config[key], payload, signal, { cwd: await hookDirectory(payload.cwd), origin: 'config' })
    if (!projectHooksOn || payload.cwd === null || !(await isDirectory(payload.cwd)) || signal.aborted) return configured
    const project = await loadProjectHooks(payload.cwd, config.projectHooks)
    if (project.kind === 'none') return configured
    if (project.kind === 'untrusted') {
      if (!reportedUntrusted.has(project.root)) {
        reportedUntrusted.add(project.root)
        warn(`skipped ${project.file}: ${project.root} is not under projectHooks.trustedDirs`)
      }
      return configured
    }
    if (project.kind === 'invalid') {
      warn(`skipped ${project.file}: ${project.problem}`)
      return configured
    }
    const fromProject = await runList(event, project.hooks[key], { ...payload, workdir: configured.workdir }, signal, {
      cwd: project.root,
      origin: 'project',
    })
    return { workdir: fromProject.workdir, contexts: [...configured.contexts, ...fromProject.contexts] }
  }

  /** What is known about a session that may no longer be live. */
  async function sessionFacts(sessionId: string): Promise<{
    cwd: string | null
    workdir: string | null
    origin?: string
    parentSessionId?: string
  }> {
    const record = await store.read(sessionId).catch((error: unknown) => {
      warn(`could not read the record of session ${sessionId}: ${String(error)}`)
      return undefined
    })
    let header = ctx.get('sessions')?.get(sessionId as SessionId)?.header
    if (header === undefined) {
      try {
        const stored = await ctx.get('sessionPersistence')?.list()
        header = stored?.find((snapshot) => snapshot.header.id === sessionId)?.header
      } catch (error) {
        logger.debug('could not list stored sessions: %s', String(error))
      }
    }
    return {
      cwd: header?.cwd ?? record?.cwd ?? null,
      workdir: record?.workdir ?? null,
      ...(header?.origin !== undefined ? { origin: header.origin } : {}),
      ...(header?.parentSession !== undefined ? { parentSessionId: header.parentSession } : {}),
    }
  }

  /** Run a list of commands in order. Later start commands see the workdir earlier ones chose. */
  async function runList(
    event: HookEventName,
    hooks: readonly HookCommand[],
    payload: HookPayload,
    signal: AbortSignal,
    { cwd, origin }: { cwd: string; origin: HookOrigin },
  ): Promise<ListOutcome> {
    let workdir = payload.workdir
    const contexts: string[] = []
    for (const [index, hook] of hooks.entries()) {
      if (signal.aborted) break
      const current: HookPayload = { ...payload, workdir }
      const label = `${event} ${origin === 'project' ? 'project ' : ''}command #${index + 1} for ${payload.session_id}`
      const result = await runCommand({
        command: hook.command,
        shell: config.shell,
        cwd,
        env: hookEnv(process.env, current),
        stdin: hookStdin(current),
        timeoutMs: hook.timeoutMs ?? config.defaultTimeoutMs,
        signal,
      })
      await runLog.append(logEntry(event, payload.session_id, origin, index + 1, result), (error) => {
        logger.debug('could not write %s: %s', runLog.file, String(error))
      })
      report(label, result)
      if (event !== 'SessionStart' || !succeeded(result)) continue
      const parsed = parseStartOutput(result.stdout)
      if (parsed.problem !== undefined) warn(`${label}: ignored part of its result: ${parsed.problem}`)
      const chosen = parsed.output?.workdir
      if (chosen !== undefined) {
        const directory = await existingDirectory(chosen, cwd)
        if (directory === undefined) warn(`${label}: workdir ${chosen} is not an existing directory; ignored`)
        else workdir = directory
      }
      if (parsed.output?.context !== undefined) contexts.push(parsed.output.context)
    }
    return { workdir, contexts }
  }

  function report(label: string, result: RunResult): void {
    if (succeeded(result)) {
      logger.debug('%s finished in %dms', label, result.durationMs)
      return
    }
    const reason =
      result.spawnError !== undefined
        ? `could not start: ${result.spawnError}`
        : result.timedOut
          ? `timed out after ${result.durationMs}ms`
          : result.aborted
            ? 'was cancelled'
            : result.exitCode !== null
              ? `exited with code ${result.exitCode}`
              : `was killed by ${result.signal ?? 'a signal'}`
    const lastLine = result.stderr.trim().split('\n').at(-1)
    warn(`${label} ${reason}${lastLine ? `: ${lastLine.slice(0, 300)}` : ''} (details: ${runLog.file})`)
  }

  /**
   * DSH keeps plugin log messages only during startup, so a warning also goes
   * to stderr, where `dsh` output (a terminal or a service log) shows it.
   */
  function warn(message: string): void {
    logger.warn(message)
    process.stderr.write(`[langify-session-hooks] ${message}\n`)
  }
}

/** Whether the session's model history already holds a note from this plugin. */
function noteInHistory(agent: Agent): boolean {
  try {
    return agent.session.deriveMessages().some((message) => message.source.kind === CONTEXT_SOURCE_KIND)
  } catch {
    return false
  }
}

/** The directory a hook runs in: the session directory when it still exists, else the DSH process directory. */
async function hookDirectory(cwd: string | null): Promise<string> {
  if (cwd !== null && (await isDirectory(cwd))) return cwd
  return process.cwd()
}

/** Resolve a workdir a command returned; relative paths are taken from the command's directory. */
async function existingDirectory(path: string, base: string): Promise<string | undefined> {
  const absolute = isAbsolute(path) ? path : resolve(base, path)
  return (await isDirectory(absolute)) ? absolute : undefined
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

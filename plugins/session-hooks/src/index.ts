/**
 * @langify/dsh-session-hooks — run shell commands on session lifecycle events.
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
import { Config, resolveConfig, type HookCommand, type StartSource } from './config.ts'
import { CONTEXT_SOURCE_KIND, startContext } from './context.ts'
import { parseStartOutput } from './output.ts'
import { hookEnv, hookStdin, type HookEventName, type HookPayload } from './payload.ts'
import { logEntry, RunLog } from './run-log.ts'
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

  if (config.sessionStart.length > 0) {
    ctx.on('agent/created', async ({ agent, source, signal }) => {
      if (!config.startSources.includes(source)) return
      const header = agent.session.header
      if (header.origin === 'subagent' && !config.includeSubagents) return
      const run = queue.run(header.id, () => onStart(agent, source, signal))
      tracker.track(run)
      await run
    })
  }

  if (config.sessionArchive.length > 0 || config.sessionUnarchive.length > 0) {
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
      if (config.sessionArchive.length > 0) {
        for (const id of archived) tracker.track(queue.run(id, () => onLifecycle('SessionArchive', config.sessionArchive, id)))
      }
      if (config.sessionUnarchive.length > 0) {
        for (const id of unarchived) tracker.track(queue.run(id, () => onLifecycle('SessionUnarchive', config.sessionUnarchive, id)))
      }
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
    const outcome = await runList('SessionStart', config.sessionStart, payload, runSignal)
    const record: SessionRecord = { sessionId: header.id, cwd, workdir: outcome.workdir, startedAt: new Date().toISOString() }
    await store.write(record).catch((error: unknown) => {
      warn(`could not record session ${header.id} in ${store.dir}: ${String(error)}`)
    })
    const note = startContext(cwd, outcome.workdir, outcome.contexts)
    if (note === undefined) return
    agent.inject(
      createUserMessage({
        content: [{ type: 'text', text: note.text }],
        source: { kind: CONTEXT_SOURCE_KIND, form: 'notice', summary: note.summary },
      }),
    )
  }

  async function onLifecycle(event: HookEventName, hooks: readonly HookCommand[], sessionId: string): Promise<void> {
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
    await runList(event, hooks, payload, lifetime.signal)
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

  /** Run an event's commands in order. Later start commands see the workdir earlier ones chose. */
  async function runList(
    event: HookEventName,
    hooks: readonly HookCommand[],
    payload: HookPayload,
    signal: AbortSignal,
  ): Promise<ListOutcome> {
    let workdir = payload.workdir
    const contexts: string[] = []
    const cwd = await hookDirectory(payload.cwd)
    for (const [index, hook] of hooks.entries()) {
      if (signal.aborted) break
      const current: HookPayload = { ...payload, workdir }
      const label = `${event} command #${index + 1} for ${payload.session_id}`
      const result = await runCommand({
        command: hook.command,
        shell: config.shell,
        cwd,
        env: hookEnv(process.env, current),
        stdin: hookStdin(current),
        timeoutMs: hook.timeoutMs ?? config.defaultTimeoutMs,
        signal,
      })
      await runLog.append(logEntry(event, payload.session_id, index + 1, result), (error) => {
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

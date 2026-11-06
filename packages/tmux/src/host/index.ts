// Host half: owns the tmux server behind the terminal tab, gives the model
// tmux tools aimed at its conversation's session, tells the model at the start
// of a turn which windows exist, and ends a conversation's tmux session when it
// is archived.
// The terminal tab is this plugin's own (src/client, host side in terminal.ts).
/// <reference types="@deepseek-ai/dsh-sandbox-policy" />
/// <reference types="@deepseek-ai/dsh-user-approval" />
/// <reference types="@deepseek-ai/dsh-workspace" />
import { access, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import {
  isReplacementSurfaceEvent,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { scrubEnv } from '../env.ts'
import { atPrompt, CLOSED, digest, GUIDE } from '../windows.ts'
import { tmuxTools } from './tool.ts'
import { TAB_KIND } from '../protocol.ts'
import { Focus, SERVICE, tmuxRunner } from './runner.ts'
import { serveTerminals, type TerminalServices } from './terminal.ts'
import { sessionIdOf, sessionName, Tmux } from './tmux.ts'

export const name = 'langify-tmux'

const SOURCE_KIND = 'langify-tmux'
const PROJECTION_KEY = 'langifyTmux'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'langify-tmux': { kind: 'langify-tmux' } & ContextFormed
  }
}

declare module '@deepseek-ai/dsh-workspace/types' {
  interface SessionActivityKindMap {
    tmux: true
  }
}

/** The last window list the model was given, and the event that carried it. */
interface DigestState {
  readonly digest: string
  readonly seq: number
}

/**
 * One projection unit, after `ProjectionDefinition` in
 * @deepseek-ai/dsh-session-projection, whose published declarations fail a strict lib check.
 */
interface ProjectionDefinition<S> {
  readonly key: string
  readonly stateVersion: number
  readonly stateSchema: z.ZodType<S>
  readonly init: () => S
  readonly apply: (state: S, event: SessionEvent) => S
}

/** The DSH host services this plugin injects. */
export interface Services extends TerminalServices {
  readonly systemPrompt: SystemPrompt
  readonly tools: { register(tool: ToolDefinition): () => void }
  readonly agents: { get(id: string): Agent | undefined }
  readonly sessions: { list(): Iterable<{ readonly id: string }> }
  readonly sessionPersistence: {
    list(): Promise<readonly { readonly header: { readonly id: string } }[]>
  }
  readonly sessionProjections: {
    register<S>(definition: ProjectionDefinition<S>): () => void
    stateOf(session: Session, key: string): unknown
  }
  readonly workspaceRegistry: { readonly archivedSessionIds: readonly string[] }
  readonly workingDirectory: WorkingDirectoryService
}

export const inject: readonly (keyof Services)[] = [
  'webServer',
  'connection',
  'systemPrompt',
  'tools',
  'agents',
  'sessions',
  'sessionPersistence',
  'sessionProjections',
  'workspaceRegistry',
  'workingDirectory',
]

export interface Config {
  tmux: string
  socket: string
}

export const Config: Schema<Config> = Schema.object({
  tmux: Schema.string()
    .default('tmux')
    .description('The tmux executable: a name looked up on PATH, or a path.'),
  socket: Schema.string().required().description("The tmux server's socket."),
})

const digestState: z.ZodType<DigestState | null> = z
  .object({ digest: z.string(), seq: z.number() })
  .nullable()
const archivedIds = z.object({ archivedSessionIds: z.array(z.string()) })

export async function apply(ctx: Context & Services, config: Config): Promise<void> {
  await mkdir(dirname(config.socket), { recursive: true, mode: 0o700 })
  const home = homedir()
  const tmux = new Tmux(config.tmux, config.socket, scrubEnv(process.env))
  const focus = new Focus()
  serveTerminals(ctx, tmux, focus)
  // For other plugins, such as tasks, without either importing the other.
  ctx.provide(SERVICE, tmuxRunner(tmux, focus, TAB_KIND))
  const warn = (what: string) => (error: unknown) =>
    ctx.logger.warn(`tmux: ${what}: ${messageOf(error)}`)

  /** The conversation a subagent works for: subagents share their conversation's terminal. */
  const owner = (agent: Agent): string => {
    let current = agent
    for (const seen = new Set<string>(); ; seen.add(current.id)) {
      const { origin, parentSession } = current.session.header
      if (origin !== 'subagent' || parentSession === undefined || seen.has(current.id)) {
        return current.id
      }
      const parent = ctx.agents.get(parentSession)
      if (parent === undefined) return parentSession
      current = parent
    }
  }
  for (const tool of tmuxTools({
    tmux,
    owner,
    cwd: (agent) => ctx.workingDirectory.get(agent.session),
    async allow(agent, exec, what) {
      // tmux runs outside the sandbox: the same one-shot escalation bash asks for.
      const effectiveMode =
        ctx.get('sandboxPolicy')?.resolve({ session: agent.session }).mode ?? 'read-only'
      await approveEscalation(
        {
          requestedMode: 'danger-full-access',
          effectiveMode,
          subject: 'command',
          justification: what,
        },
        {
          approver: ctx.get('approval'),
          agent,
          callId: exec.callId,
          toolName: exec.name,
          signal: exec.signal,
        },
      )
    },
  })) {
    ctx.effect(() => ctx.tools.register(tool), `tmux: ${tool.name}`)
  }

  // What does not change: the terminal, the tools and the <tmux> notes.
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'langify-tmux',
        order: ctx.systemPrompt.getSectionOrder('TOOL_PTY') + 1,
        text: GUIDE,
        interpolate: false,
      }),
    'tmux: system prompt',
  )

  // The window list at the start of a turn, when it changed since the model last saw it.
  ctx.effect(
    () =>
      ctx.sessionProjections.register<DigestState | null>({
        key: PROJECTION_KEY,
        stateVersion: 1,
        stateSchema: digestState,
        init: () => null,
        apply: (state, event) => {
          if (event.type === 'user/message' && event.data.source.kind === SOURCE_KIND) {
            const block = event.data.content[0]
            return block?.type === 'text' ? { digest: block.text, seq: event.seq } : state
          }
          // Compaction hid the last list from the model: tell it again.
          if (
            state !== null &&
            isReplacementSurfaceEvent(event) &&
            event.sourceEventSeqs?.some((seq) => seq === state.seq) === true
          ) {
            return null
          }
          return state
        },
      }),
    'tmux: digest projection',
  )
  let tmuxMissing = false
  ctx.on(
    'agent/pre-step',
    async ({ agent, step, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
      if (agent.session.header.origin === 'subagent' || tmuxMissing) return decision
      let text: string | undefined
      try {
        const session = sessionName(agent.id)
        text = digest(await tmux.windows(session), home)
      } catch (error) {
        tmuxMissing = /ENOENT/.test(messageOf(error))
        warn('reading windows')(error)
        return decision
      }
      const last = digestState.safeParse(
        ctx.sessionProjections.stateOf(agent.session, PROJECTION_KEY),
      )
      const lastDigest = last.success ? last.data?.digest : undefined
      if (text === undefined) {
        if (lastDigest === undefined) return decision
        text = CLOSED
      }
      if (text === lastDigest) return decision
      return { ...decision, messages: [...decision.messages, contextMessage(text)] }
    },
    { prepend: true },
  )

  // Archiving: programs still running in the session are work the archive dialog offers to stop.
  ctx.on('workspace/session-activity', async ({ sessionId }, next) => {
    const rest = await next()
    const busy = (await tmux.windows(sessionName(sessionId)).catch(() => [])).filter(
      (w) => !atPrompt(w),
    )
    if (busy.length === 0) return rest
    return [{ kind: 'tmux', items: busy.map((w) => ({ id: w.id, label: w.command })) }, ...rest]
  })
  ctx.on('workspace/session-stop', async ({ sessionId }) => {
    const sessions = await tmux.sessions()
    await tmux.kill(sessions.get(sessionName(sessionId)) ?? [])
  })

  /** End the tmux sessions of archived conversations, and with `unknown` also of conversations that no longer exist. */
  const reconcile = async (archived: readonly string[], unknown: boolean): Promise<void> => {
    const sessions = await tmux.sessions()
    if (sessions.size === 0) return
    const ended = new Set(archived)
    let known: Set<string> | undefined
    if (unknown) {
      known = new Set((await ctx.sessionPersistence.list()).map((s) => s.header.id))
      for (const session of ctx.sessions.list()) known.add(session.id)
    }
    for (const [base, names] of sessions) {
      const id = sessionIdOf(base)
      if (id !== undefined && (ended.has(id) || (known !== undefined && !known.has(id))))
        await tmux.kill(names)
    }
  }
  // Every archive, including one with nothing running, which skips session-stop.
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return
    const state = archivedIds.safeParse(change.value)
    if (state.success)
      reconcile(state.data.archivedSessionIds, false).catch(warn('ending archived sessions'))
  })

  // The server outlives DSH restarts; sessions of conversations archived or deleted meanwhile end here.
  const start = async (): Promise<void> => {
    await tmux.start()
    // The user's own configuration, wherever this tmux looks for it, wins.
    const found = await Promise.all((await tmux.configFiles()).map(exists))
    if (!found.some(Boolean)) await tmux.applyDefaults()
    await reconcile(ctx.workspaceRegistry.archivedSessionIds, true)
  }
  start().catch(warn('starting'))
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

function contextMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'snapshot', sections: [{ name: SOURCE_KIND, text }] },
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

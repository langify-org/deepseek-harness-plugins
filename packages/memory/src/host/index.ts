// Host: keeps a memory directory up to date from every conversation, and gives
// conversations what it holds.
//
// Writing: when a conversation's turn ends, the part of it not read yet goes to a
// new scribe, a subagent of the day's memory conversation in the memory
// directory's workspace. The memory conversation only holds the day's scribes:
// its one turn, a short reply when it starts, is there for the sidebar to list it. One scribe works at a time; its changes become one
// commit whose message is its reply. A turn that ends in any other conversation
// in that workspace (someone working on memory there) is committed the same way.
//
// Reading: at the start of a conversation's turn, it is given the beginning of
// the index the first time, and afterwards what changed in other conversations.
/// <reference types="@deepseek-ai/dsh-api-session-controller" />
/// <reference types="@deepseek-ai/dsh-session-query" />
/// <reference types="@deepseek-ai/dsh-session-title" />
/// <reference types="@deepseek-ai/dsh-subagent" />
import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  isReplacementSurfaceEvent,
  SessionId,
  type Session,
  type SessionEvent,
} from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { baselineText, indexHead, updateText } from '../delivery.ts'
import {
  AGENTS_MD,
  commitMessage,
  MEMORY_CONVERSATION,
  MEMORY_MD,
  scribeRequest,
} from '../scribe.ts'
import { renderTranscript, unreadFrom } from '../transcript.ts'
import { Repository } from './repository.ts'

export const name = 'langify-memory'

const CONTEXT_KIND = 'langify-memory'
const DAY_KIND = 'langify-memory-day'
const PROJECTION_KEY = 'langifyMemory'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Memory given to a conversation: the index when `baseline`, otherwise what changed. */
    'langify-memory': { kind: 'langify-memory'; version: string; baseline?: true } & ContextFormed
    /** The one message a day's memory conversation is given. */
    'langify-memory-day': { kind: 'langify-memory-day' }
  }
}

export const inject: readonly string[] = [
  'sessionQuery',
  'sessionController',
  'sessionProjections',
  'subagents',
  'workspaceRegistry',
  'storageDomain',
]

export interface Config {
  directory: string
  git: string
  timeZone?: string
  dayStartsAt: number
  subagentProvider: string
  toolArguments: number
  toolResult: number
  indexLines: number
  indexBytes: number
  rebaselineAfter: number
}

export const Config: Schema<Config> = Schema.object({
  directory: Schema.string().required().description('The memory directory.'),
  git: Schema.string()
    .default('git')
    .description('The git executable: a name looked up on PATH, or a path.'),
  timeZone: Schema.string().description(
    "The IANA time zone of the memory conversations' days. Without it, the host's.",
  ),
  dayStartsAt: Schema.natural()
    .max(23)
    .default(3)
    .description('The hour a new memory conversation starts the day.'),
  subagentProvider: Schema.string()
    .default('spawn')
    .description('The subagent provider that starts the scribes.'),
  toolArguments: Schema.natural()
    .default(300)
    .description("Characters of a tool call's arguments a scribe reads."),
  toolResult: Schema.natural()
    .default(500)
    .description('Characters of a tool result a scribe reads.'),
  indexLines: Schema.natural()
    .default(200)
    .description('Lines of MEMORY.md a conversation is given when it starts.'),
  indexBytes: Schema.natural()
    .default(25600)
    .description('Bytes of MEMORY.md a conversation is given when it starts.'),
  rebaselineAfter: Schema.natural()
    .default(20)
    .description(
      'Commits after which a conversation is given MEMORY.md again instead of what changed.',
    ),
})

/** What the plugin keeps: how far each conversation has been read, and each day's memory conversation. */
const domain = defineDomain({
  name: 'langify_memory',
  version: 1,
  tables: {
    /** Conversation id → the last event a scribe recorded. */
    read: domainTable<string, { seq: number }>(z.object({ seq: z.number() })),
    /** Day (YYYY-MM-DD) → that day's memory conversation. */
    scribes: domainTable<string, { sessionId: string }>(z.object({ sessionId: z.string() })),
  },
})

/** What a conversation was given of memory: the index at `baseline`, in event `baselineSeq`, then changes up to `version`. */
interface Given {
  readonly baseline: string
  readonly baselineSeq: number
  readonly version: string
}

const givenState: z.ZodType<Given | null> = z
  .object({ baseline: z.string(), baselineSeq: z.number(), version: z.string() })
  .nullable()

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

interface Projections {
  register<S>(definition: ProjectionDefinition<S>): () => void
  stateOf(session: Session, key: string): unknown
}

/** A turn of a conversation in the memory workspace, followed until it ends. */
interface MemoryTurn {
  reply: string
}

/** Services this plugin uses whose published declarations it cannot import. */
export interface Services {
  readonly sessionProjections: Projections
}

export async function apply(ctx: Context & Services, config: Config): Promise<void> {
  const repository = new Repository(config.git, config.directory)
  await repository.init({ 'AGENTS.md': AGENTS_MD, 'MEMORY.md': MEMORY_MD })
  const directories = [config.directory, await realpath(config.directory)]
  const store = await ctx.storageDomain.open(domain)
  ctx.effect(() => () => store.close(), 'memory: storage')
  const read = store.table('read')
  const days = store.table('scribes')
  const projections = ctx.sessionProjections
  const warn = (what: string) => (error: unknown) =>
    ctx.logger.warn(`memory: ${what}: ${messageOf(error)}`)

  /** Memory as it is now: the commit, and the index at it. */
  let current = await snapshot()
  async function snapshot(): Promise<{ head: string; index: string | undefined }> {
    const head = await repository.head()
    return { head, index: await repository.show(head, 'MEMORY.md') }
  }
  // Commits one at a time, in the order the turns ended.
  let committing: Promise<unknown> = Promise.resolve()
  const commit = (message: string): Promise<void> => {
    const done = committing.then(async () => {
      if (await repository.commit(message)) current = await snapshot()
    })
    committing = done.catch(warn('committing'))
    return done
  }

  const inMemory = (session: Session): boolean => {
    const { cwd } = session.header
    return cwd !== undefined && directories.some((d) => cwd === d || cwd.startsWith(d + sep))
  }
  /** Conversations that are remembered and given memory: not subagents, not memory's own. */
  const remembered = (session: Session): boolean =>
    session.header.origin !== 'subagent' && !inMemory(session)

  /** The memory conversation's day: it starts at `dayStartsAt`, not at midnight. */
  const day = (): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(Date.now() - config.dayStartsAt * 3_600_000))

  const workspace = async (): Promise<Workspace> =>
    (await ctx.workspaceRegistry.resolveByPath(config.directory)) ??
    ctx.workspaceRegistry.create(config.directory, 'memory')
  await workspace()

  /**
   * Today's memory conversation, started when there is none, it was archived, or
   * it can no longer be opened. DSH runs no subagent of an archived conversation.
   */
  const memoryConversation = async (): Promise<Agent> => {
    const today = day()
    const known = days.get(today)
    const archived = (id: string): boolean =>
      ctx.workspaceRegistry.archivedSessionIds.some((archivedId) => archivedId === id)
    if (known !== undefined && !archived(known.sessionId)) {
      const resolved = await ctx.sessionController.resolveAgent(SessionId(known.sessionId))
      if ('agent' in resolved) return open(resolved.agent)
      warn(`opening the memory conversation ${known.sessionId}`)(resolved.error)
    }
    const { id } = await workspace()
    const { sessionId } = await ctx.sessionController.create({ workspaceId: id })
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    // The title is its first event: it makes the conversation durable and named.
    ctx.get('sessionTitle')?.rename(resolved.agent.session, `Memory · ${today}`)
    await days.put(today, { sessionId })
    return open(resolved.agent)
  }

  /**
   * Give a memory conversation that never had a turn its one turn. The sidebar
   * hides conversations without one, and the scribes with them.
   */
  const opened = new Set<string>()
  const open = async (agent: Agent): Promise<Agent> => {
    if (opened.has(agent.id)) return agent
    opened.add(agent.id)
    const log = await ctx.sessionQuery.readSession(agent.session.id)
    if (!log.events.some((event) => event.type === 'turn/start')) {
      agent.followup(
        createUserMessage({
          content: [{ type: 'text', text: MEMORY_CONVERSATION }],
          source: { kind: DAY_KIND },
        }),
      )
    }
    return agent
  }

  // One scribe at a time, in the order the turns ended: one writer of memory.
  let recording: Promise<void> = Promise.resolve()
  const record = async (session: Session, to: number): Promise<void> => {
    const log = await ctx.sessionQuery.readSession(session.id)
    const from = Math.max(
      unreadFrom(log.events, read.get(session.id)?.seq, to),
      log.inheritedEventCount,
    )
    if (from > to) return
    const events = log.events.filter((event) => event.seq >= from && event.seq <= to)
    const transcript = renderTranscript(events, {
      toolArguments: config.toolArguments,
      toolResult: config.toolResult,
    })
    if (transcript === '') {
      await read.put(session.id, { seq: to })
      return
    }
    const title = ctx.get('sessionTitle')?.get(session)?.title
    const text = scribeRequest(
      { sessionId: session.id, title, cwd: session.header.cwd, from, to },
      transcript,
    )
    const activation = await ctx.subagents.startActivation({
      provider: config.subagentProvider,
      label: title ?? session.id,
      prompt: [{ type: 'text', text }],
      parent: await memoryConversation(),
      signal: AbortSignal.timeout(60_000),
      delivery: 'caller',
    })
    try {
      const result = await activation.result
      const reply = result.output
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
      const stopped =
        result.stopReason === 'completed' ? '' : `\n\n(The scribe stopped: ${result.stopReason}.)`
      await commit(commitMessage(reply + stopped, [session.id]))
      // What a scribe did not finish is read again with the next turn.
      if (result.stopReason === 'completed') await read.put(session.id, { seq: to })
      else warn(`recording ${session.id}`)(result.diagnostic ?? result.stopReason)
    } finally {
      await activation.dispose()
    }
  }

  // Someone working on memory in its workspace: their turns are committed as they end.
  const turns = new Map<string, MemoryTurn>()
  const follow = (session: Session, event: SessionEvent): void => {
    switch (event.type) {
      case 'turn/start':
        turns.set(session.id, { reply: '' })
        break
      case 'assistant/message': {
        const turn = turns.get(session.id)
        const text = event.data.message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim()
        if (turn !== undefined && text !== '') turn.reply = text
        break
      }
      case 'turn/end': {
        const reply = turns.get(session.id)?.reply ?? ''
        turns.delete(session.id)
        commit(commitMessage(reply, [])).catch(() => {})
        break
      }
      default:
        break
    }
  }

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (remembered(session)) {
      if (event.type !== 'turn/end') return
      recording = recording
        .then(() => record(session, event.seq))
        .catch(warn(`recording ${session.id}`))
    } else if (inMemory(session) && session.header.origin !== 'subagent') {
      // Scribes are subagents, committed by `record` with their sources.
      follow(session, event)
    }
  })

  // What each conversation was given, read back from its log.
  ctx.effect(
    () =>
      projections.register<Given | null>({
        key: PROJECTION_KEY,
        stateVersion: 1,
        stateSchema: givenState,
        init: () => null,
        apply: (state, event) => {
          if (event.type === 'user/message' && event.data.source.kind === CONTEXT_KIND) {
            const { version, baseline } = event.data.source
            if (baseline === true) return { baseline: version, baselineSeq: event.seq, version }
            return state === null ? state : { ...state, version }
          }
          // Compaction hid the index from the model: give it again.
          if (
            state !== null &&
            isReplacementSurfaceEvent(event) &&
            event.sourceEventSeqs?.some((seq) => seq === state.baselineSeq) === true
          ) {
            return null
          }
          return state
        },
      }),
    'memory: given projection',
  )

  /** What `session` should be given now, if anything. */
  const memoryFor = async (session: Session): Promise<UserMessage | undefined> => {
    const parsed = givenState.safeParse(projections.stateOf(session, PROJECTION_KEY))
    const given = parsed.success ? parsed.data : null
    const { head, index } = current
    const baseline = (): UserMessage => {
      const text = baselineText(
        config.directory,
        head,
        index === undefined
          ? undefined
          : indexHead(index, { lines: config.indexLines, bytes: config.indexBytes }),
      )
      return contextMessage(text, {
        kind: CONTEXT_KIND,
        version: head,
        baseline: true,
        form: 'snapshot',
        sections: [{ name: CONTEXT_KIND, text }],
      })
    }
    if (given === null) return baseline()
    if (given.version === head) return undefined
    const sinceBaseline = await repository.commits(given.baseline, head)
    if (sinceBaseline === undefined || sinceBaseline.length > config.rebaselineAfter)
      return baseline()
    const since = await repository.commits(given.version, head)
    if (since === undefined) return baseline()
    // What this conversation itself taught memory, it already knows.
    const news = since.filter(
      (c) => c.sources.length === 0 || c.sources.some((id) => id !== session.id),
    )
    if (news.length === 0) return undefined
    const text = updateText(given.version, head, news)
    return contextMessage(text, {
      kind: CONTEXT_KIND,
      version: head,
      form: 'notice',
      summary: `Memory changed in ${news.length} commit(s)`,
    })
  }

  ctx.on(
    'agent/pre-step',
    async ({ agent, step, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted || step !== 1) return decision
      if (!remembered(agent.session)) return decision
      try {
        const message = await memoryFor(agent.session)
        return message === undefined
          ? decision
          : { ...decision, messages: [...decision.messages, message] }
      } catch (error) {
        warn(`giving memory to ${agent.session.id}`)(error)
        return decision
      }
    },
    { prepend: true },
  )
}

function contextMessage(
  text: string,
  source: { kind: 'langify-memory'; version: string; baseline?: true } & ContextFormed,
): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

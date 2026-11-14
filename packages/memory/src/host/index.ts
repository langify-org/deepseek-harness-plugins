// Host: keeps a memory directory up to date from every conversation, and gives
// conversations what it holds.
//
// Writing: when a conversation's turn ends, the part of it not read yet goes to
// the conversation's scribe, a subagent of the day's memory conversation in the
// memory directory's workspace. The memory conversation only holds the day's
// scribes: its one turn, a short reply when it starts, is there for the sidebar
// to list it. One scribe works at a time; the changes of its turn become one
// commit whose message is its reply. A turn that ends in any other conversation
// in that workspace (someone working on memory there) is committed the same way.
//
// A scribe goes on with its conversation turn after turn, so it knows what it
// already recorded and its history is read from the prompt cache. A new scribe
// takes over when the conversation paused for longer than the cache lasts or the
// scribe's context grew long: every step reads the whole context again, so a long
// one costs more than starting over. The new scribe starts from the user's
// guidance, the index, and the end of what the conversation said.
//
// The memory conversation and its scribes run on the memory preset (declared in
// cordis.patch.yml): file tools and nothing else.
//
// Reading: at the start of a conversation's turn, it is given the beginning of
// the index the first time, and afterwards what changed in other conversations.
/// <reference types="@deepseek-ai/dsh-agent-preset-registry" />
/// <reference types="@deepseek-ai/dsh-api-session-controller" />
/// <reference types="@deepseek-ai/dsh-session-query" />
/// <reference types="@deepseek-ai/dsh-session-title" />
/// <reference types="@deepseek-ai/dsh-subagent" />
/// <reference types="@deepseek-ai/dsh-tools" />
import { readFile, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import {
  createUserMessage,
  ReasoningEffortId,
  type ContextFormed,
  type UserMessage,
} from '@deepseek-ai/dsh-llm'
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
  GUIDANCE_FILE,
  INDEX_FILE,
  MEMORY_CONVERSATION,
  MEMORY_MD,
  firstRequest,
  nextRequest,
} from '../scribe.ts'
import { renderContext, renderTranscript, unreadFrom } from '../transcript.ts'
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
  'agents',
  'agentPresets',
  'tools',
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
  agentPreset: string
  scribeProvider?: string
  scribeModel?: string
  scribeReasoningEffort?: string
  toolArguments: number
  toolResult: number
  contextChars: number
  continueSeconds: number
  continueTokens: number
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
  agentPreset: Schema.string()
    .default('langify-memory')
    .description('The agent preset the memory conversations and their scribes run on.'),
  scribeProvider: Schema.string().description(
    "The LLM provider of the scribes' model, set together with scribeModel. Without them, the memory conversation's model.",
  ),
  scribeModel: Schema.string().description("The scribes' model, set together with scribeProvider."),
  scribeReasoningEffort: Schema.string().description(
    "The scribes' reasoning effort, one the model offers. Without it, the model's default.",
  ),
  toolArguments: Schema.natural()
    .default(300)
    .description("Characters of a tool call's arguments a scribe reads."),
  toolResult: Schema.natural()
    .default(500)
    .description('Characters of a tool result a scribe reads.'),
  contextChars: Schema.natural()
    .default(8000)
    .description(
      'Characters of what a conversation said before the part to record that a new scribe is given as context.',
    ),
  continueSeconds: Schema.natural()
    .default(300)
    .description(
      "Seconds after a scribe's turn within which it goes on with its conversation's next turn: how long the prompt cache keeps its history. 0 starts a new scribe every turn.",
    ),
  continueTokens: Schema.natural()
    .default(30000)
    .description(
      "Tokens of context up to which a scribe goes on with its conversation's next turn.",
    ),
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
  /** The context the turn's last step ran with, and what it added. */
  tokens: number
}

/** How a scribe's turn ended: `ended` is `completed`, or why it stopped short. */
interface ScribeTurn {
  readonly reply: string
  readonly ended: string
}

/** The scribe of a conversation, as its last turn left it. */
interface Scribe {
  readonly id: string
  /** The memory conversation it is a subagent of. */
  readonly parent: string
  /** When its last turn ended, in milliseconds. */
  readonly at: number
  /** The commit memory was at when its last turn ended. */
  readonly seen: string
}

/** How long a scribe that goes on has for one turn before it is stopped. */
const SCRIBE_TURN_MS = 600_000

/** Services this plugin uses whose published declarations it cannot import. */
export interface Services {
  readonly sessionProjections: Projections
}

export async function apply(ctx: Context & Services, config: Config): Promise<void> {
  if ((config.scribeProvider === undefined) !== (config.scribeModel === undefined)) {
    throw new Error('memory: scribeProvider and scribeModel are set together')
  }
  /** What a scribe runs on where it differs from the memory conversation. */
  const scribeOptions: AgentOptions = {
    ...(config.scribeProvider === undefined ? {} : { provider: config.scribeProvider }),
    ...(config.scribeModel === undefined ? {} : { model: config.scribeModel }),
    ...(config.scribeReasoningEffort === undefined
      ? {}
      : { reasoningEffort: ReasoningEffortId(config.scribeReasoningEffort) }),
  }
  const repository = new Repository(config.git, config.directory)
  await repository.init({ [GUIDANCE_FILE]: AGENTS_MD, [INDEX_FILE]: MEMORY_MD })
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
    return { head, index: await repository.show(head, INDEX_FILE) }
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
    const { sessionId } = await ctx.sessionController.create({
      workspaceId: id,
      agentPreset: config.agentPreset,
    })
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

  /** A file of the memory directory as it is on disk, where a scribe would read it. */
  const memoryFile = (file: string): Promise<string | undefined> =>
    readFile(join(config.directory, file), 'utf8').catch((error: unknown) => {
      if (isMissing(error)) return undefined
      throw error
    })

  // The memory preset's agents see the preset's tools and none of the profile's
  // global ones (MCP servers, browser control and so on): hidden when the agent
  // is created, so a tool registered globally afterwards stays visible to it.
  const hidden = new Map<string, () => void>()
  ctx.effect(
    () => () => {
      for (const dispose of hidden.values()) dispose()
      hidden.clear()
    },
    'memory: hidden tools',
  )
  ctx.on('agent/created', ({ agent }) => {
    if (ctx.agentPresets.composedPreset(agent.ctx) !== config.agentPreset) return undefined
    const globals = ctx.tools.schemas().map((schema) => schema.name)
    if (globals.length === 0) return undefined
    hidden.set(
      agent.id,
      agent.ctx.effect(() => agent.ctx.tools.restrict({ deny: globals }), 'memory: hidden tools'),
    )
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    hidden.delete(agent.id)
  })

  // Turns of the conversations in the memory workspace, followed as they go.
  const turns = new Map<string, MemoryTurn>()
  /** The context size of each scribe after its last turn. */
  const sizes = new Map<string, number>()
  /** Who waits for a scribe's turn to end. */
  const waiting = new Map<string, (turn: ScribeTurn) => void>()
  const follow = (session: Session, event: SessionEvent): void => {
    switch (event.type) {
      case 'turn/start':
        turns.set(session.id, { reply: '', tokens: 0 })
        break
      case 'assistant/message': {
        const turn = turns.get(session.id)
        if (turn === undefined) break
        const text = event.data.message.content
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n')
          .trim()
        if (text !== '') turn.reply = text
        const { usage } = event.data
        if (usage !== undefined) {
          turn.tokens =
            usage.totalTokens ??
            usage.inputTokens +
              usage.outputTokens +
              (usage.cacheReadTokens ?? 0) +
              (usage.cacheWriteTokens ?? 0)
        }
        break
      }
      case 'turn/end': {
        const turn = turns.get(session.id) ?? { reply: '', tokens: 0 }
        turns.delete(session.id)
        if (session.header.origin === 'subagent') {
          // A scribe: `record` commits its turn, with the conversation it came from.
          sizes.set(session.id, turn.tokens)
          waiting.get(session.id)?.({ reply: turn.reply, ended: event.data.reason.kind })
        } else {
          // Someone working on memory in its workspace.
          commit(commitMessage(turn.reply, [])).catch(() => {})
        }
        break
      }
      default:
        break
    }
  }

  /** Start a new scribe under `parent` with its first message, and wait for its turn. */
  const start = async (
    parent: Agent,
    label: string,
    text: string,
  ): Promise<{ id: string; turn: ScribeTurn }> => {
    const activation = await ctx.subagents.startActivation({
      provider: config.subagentProvider,
      agentPreset: config.agentPreset,
      agentOptions: scribeOptions,
      label,
      prompt: [{ type: 'text', text }],
      parent,
      signal: AbortSignal.timeout(60_000),
      delivery: 'caller',
    })
    try {
      const result = await activation.result
      if (result.diagnostic !== undefined)
        warn(`the scribe ${activation.childId}`)(result.diagnostic)
      const reply = result.output
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
      return { id: activation.childId, turn: { reply, ended: result.stopReason } }
    } finally {
      // The scribe's session stays; a later message resumes it.
      await activation.dispose()
    }
  }

  /** Give a scribe that finished a turn its next message, and wait for the turn it starts. */
  const resume = async (parent: Agent, id: string, text: string): Promise<ScribeTurn> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const ended = new Promise<ScribeTurn>((resolve, reject) => {
        waiting.set(id, resolve)
        timer = setTimeout(
          () => reject(new Error('the scribe did not finish its turn')),
          SCRIBE_TURN_MS,
        )
      })
      await ctx.subagents.sendMessage(parent, SessionId(id), [{ type: 'text', text }], {
        signal: AbortSignal.timeout(60_000),
      })
      return await ended
    } catch (error) {
      // A scribe that may still be writing: the next one must be the only writer.
      ctx.agents.get(SessionId(id))?.cancel({ kind: 'parent' })
      throw error
    } finally {
      clearTimeout(timer)
      waiting.delete(id)
    }
  }

  // One scribe at a time, in the order the turns ended: one writer of memory.
  const scribes = new Map<string, Scribe>()
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
    const source = { sessionId: session.id, title, cwd: session.header.cwd, from, to }
    const parent = await memoryConversation()

    const known = scribes.get(session.id)
    scribes.delete(session.id)
    let scribe: { id: string; turn: ScribeTurn } | undefined
    if (
      known !== undefined &&
      known.parent === parent.id &&
      Date.now() - known.at <= config.continueSeconds * 1000 &&
      (sizes.get(known.id) ?? 0) <= config.continueTokens
    ) {
      try {
        const changed = await repository.changed(known.seen, current.head)
        const turn = await resume(parent, known.id, nextRequest(source, changed, transcript))
        scribe = { id: known.id, turn }
      } catch (error) {
        warn(`going on with the scribe ${known.id}`)(error)
      }
    }
    if (scribe === undefined) {
      const index = await memoryFile(INDEX_FILE)
      const memory = {
        guidance: await memoryFile(GUIDANCE_FILE),
        index:
          index === undefined
            ? undefined
            : indexHead(index, { lines: config.indexLines, bytes: config.indexBytes }),
        indexLines: config.indexLines,
        indexBytes: config.indexBytes,
      }
      const context = renderContext(
        log.events.filter((event) => event.seq < from),
        config.contextChars,
      )
      scribe = await start(
        parent,
        title ?? session.id,
        firstRequest(source, memory, context, transcript),
      )
    }

    const { id, turn } = scribe
    const stopped = turn.ended === 'completed' ? '' : `\n\n(The scribe stopped: ${turn.ended}.)`
    await commit(commitMessage(turn.reply + stopped, [session.id]))
    if (turn.ended !== 'completed') {
      // What a scribe did not finish is read again with the next turn, by a new scribe.
      warn(`recording ${session.id}`)(turn.ended)
      return
    }
    await read.put(session.id, { seq: to })
    scribes.set(session.id, { id, parent: parent.id, at: Date.now(), seen: current.head })
  }

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (remembered(session)) {
      if (event.type !== 'turn/end') return
      recording = recording
        .then(() => record(session, event.seq))
        .catch(warn(`recording ${session.id}`))
    } else if (inMemory(session)) {
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

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

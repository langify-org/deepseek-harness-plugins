// Host: keeps a memory directory up to date from every conversation, and gives
// conversations what it holds.
//
// The directory holds two kinds of files, as memory does. Episodes are the record
// of what conversations said, noted as they went and never rewritten. The other
// files are what is known, by subject, made from the episodes once a day.
//
// Noting: when a conversation's turn ends, the part of it not read yet goes to
// the conversation's scribe, a subagent of the day's memory conversation in the
// memory directory's workspace. The scribe's reply is the part's entry, and the
// plugin appends it to the conversation's file of episodes for the day: a scribe
// writes no file, so it can neither reorganize nor overwrite. One scribe works at
// a time, and an entry is one commit.
//
// A conversation keeps one scribe for the day, so the scribe knows what it
// already noted and its history is read from the prompt cache. A scribe that
// is new to a conversation nearly always notes something on its first turn, so
// every handover adds what no one needed; a scribe is therefore
// replaced only when the day's memory conversation is, or when its context grew
// past `continueTokens`, a guard against a runaway one. The new scribe starts
// from the user's guidance, the index, and the end of what the conversation said.
// DSH's compaction cannot stand in for the replacement: its request to condense
// comes after the part to note, which runs to the end of the message, so the
// scribe takes it for more of the conversation (35 of 58 attempts failed so).
//
// Consolidating: a day's memory conversation starts when the day does, and its
// first turns bring what is known up to date from the episodes added since the
// last time: each new entry is set beside the lines it may be about, with the
// question which of them it disagrees with, and then what the episodes
// established goes under the subject it is about. Scribes wait until it is
// done. After it the memory conversation only holds the day's scribes, and
// episodes older than `episodeDays` leave the directory. A night that did not
// complete leaves its episodes to the next. What the scribes were
// given is kept beside the directory for some days, so a note can be checked
// against what the conversation said. A turn that ends in any other conversation
// of the memory workspace (someone working on memory there) is committed with its
// reply. /dream does the same at any time, in a conversation of its own: what was
// consolidated is marked, so the night takes up only what came after.
//
// The memory conversation and its scribes run on the memory preset (declared in
// cordis.patch.yml): file tools and nothing else, and for scribes only those that read.
//
// Reading: before a step of a conversation, it is given the beginning of the
// index and the names of the files of episodes not yet in what is known the
// first time, and afterwards the names of the files that changed; a long turn
// is told while it goes on. When something is said in it, it is also given the
// lines of the current notes that what was said calls for, and on the first
// time of a day those that name the day. With a watcher model set, a small
// model also watches each conversation from outside and, before a step, brings
// up a hunch when what just happened is the moment it is about (../hunch.ts).
/// <reference types="@deepseek-ai/dsh-agent-preset-registry" />
/// <reference types="@deepseek-ai/dsh-api-session-controller" />
/// <reference types="@deepseek-ai/dsh-commands" />
/// <reference types="@deepseek-ai/dsh-session-query" />
/// <reference types="@deepseek-ai/dsh-session-title" />
/// <reference types="@deepseek-ai/dsh-subagent" />
/// <reference types="@deepseek-ai/dsh-tools" />
import { appendFile, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import {
  BlockAssembler,
  createUserMessage,
  ReasoningEffortId,
  type ContextFormed,
  type GenerateOptions,
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
import {
  baselineText,
  indexHead,
  recallText,
  todayText,
  updateText,
  type Recent,
} from '../delivery.ts'
import {
  broughtUp,
  HUNCHES,
  hunchesOf,
  hunchText,
  QUESTIONS_FILE,
  watcherRequest,
  watcherSystem,
  type Hunch,
} from '../hunch.ts'
import { naming, noteLines, recall, scored, type NoteLine } from '../related.ts'
import {
  AGENTS_MD,
  commitMessage,
  compareRequest,
  consolidateRequest,
  EPISODES,
  episodeEntries,
  episodeEntry,
  episodeHead,
  newEntries,
  type Compared,
  GUIDANCE_FILE,
  INDEX_FILE,
  MEMORY_MD,
  NOTHING,
  firstRequest,
  keptPart,
  nextRequest,
  type ScribeSource,
} from '../scribe.ts'
import { renderContext, renderTranscript, unreadFrom } from '../transcript.ts'
import { Repository } from './repository.ts'

export const name = 'langify-memory'

const CONTEXT_KIND = 'langify-memory'
const RECALL_KIND = 'langify-memory-recall'
const DAY_KIND = 'langify-memory-day'
const HUNCH_KIND = 'langify-memory-hunch'
const PROJECTION_KEY = 'langifyMemory'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** Memory given to a conversation: the index when `baseline`, otherwise what changed. */
    'langify-memory': { kind: 'langify-memory'; version: string; baseline?: true } & ContextFormed
    /** The first message of a day's memory conversation, which asks it to tidy the directory. */
    'langify-memory-day': { kind: 'langify-memory-day' }
    /** Lines of memory put beside what was just said in a conversation. */
    'langify-memory-recall': { kind: 'langify-memory-recall' } & ContextFormed
    /** The hunches the watcher brought up in a conversation, by `files`; and what the watcher was shown. */
    'langify-memory-hunch': {
      kind: 'langify-memory-hunch'
      files?: readonly string[]
    } & ContextFormed
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
  'llm',
  'commands',
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
  tidyProvider?: string
  tidyModel?: string
  tidyReasoningEffort?: string
  watcherProvider?: string
  watcherModel?: string
  watcherReasoningEffort?: string
  toolArguments: number
  toolResult: number
  contextChars: number
  continueTokens: number
  transcripts?: string
  transcriptDays: number
  episodeDays: number
  indexLines: number
  indexBytes: number
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
  tidyProvider: Schema.string().description(
    "The LLM provider of the model that tidies the directory, set together with tidyModel. Without them, the default model when the day's memory conversation starts.",
  ),
  tidyModel: Schema.string().description(
    'The model that tidies the directory, set together with tidyProvider.',
  ),
  tidyReasoningEffort: Schema.string().description(
    "The reasoning effort of tidying, one the model offers. Without it, the model's default.",
  ),
  watcherProvider: Schema.string().description(
    'The LLM provider of the small model that watches conversations and brings up hunches, set together with watcherModel. Without them, no hunch is brought up.',
  ),
  watcherModel: Schema.string().description(
    'The model that watches conversations and brings up hunches, set together with watcherProvider.',
  ),
  watcherReasoningEffort: Schema.string().description(
    "The watcher's reasoning effort, one the model offers. Without it, the model's default.",
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
  continueTokens: Schema.natural()
    .default(200000)
    .description(
      "Tokens of context past which a conversation's scribe is replaced by a new one: a guard against a runaway scribe, not a setting to tune.",
    ),
  transcripts: Schema.string().description(
    'The directory where what the scribes were given of the conversations is kept for the tidying agent, as plain text. Without it, the memory directory with `-transcripts` added to its name.',
  ),
  transcriptDays: Schema.natural()
    .default(7)
    .description('Days for which what the scribes were given is kept.'),
  episodeDays: Schema.natural()
    .default(30)
    .description(
      'Days for which episodes stay in the directory. What is to be known for longer is in the other files by then; git keeps the rest.',
    ),
  indexLines: Schema.natural()
    .default(200)
    .description('Lines of MEMORY.md a conversation is given when it starts.'),
  indexBytes: Schema.natural()
    .default(25600)
    .description('Bytes of MEMORY.md a conversation is given when it starts.'),
})

/** The scribe of a conversation, as its last turn left it. */
interface Scribe {
  readonly id: string
  /** The memory conversation it is a subagent of. */
  readonly parent: string
  /** Its context after its last turn, in tokens. */
  readonly tokens: number
  /** What it was told a scribe does: a scribe goes on only under what it was started with. */
  readonly protocol?: number | undefined
}

/**
 * What the plugin keeps: how far each conversation has been read, each day's
 * memory conversation, and each conversation's scribe.
 */
const domain = defineDomain({
  name: 'langify_memory',
  // 2: `marks`, and a scribe's `protocol` in place of the commit it last saw. What 1 stored is
  // read as it is: a scribe without a protocol is one of the earlier kind and is not gone on with.
  version: 2,
  compatibleVersions: [1],
  tables: {
    /** Conversation id → the last event a scribe recorded. */
    read: domainTable<string, { seq: number }>(z.object({ seq: z.number() })),
    /** Day (YYYY-MM-DD) → that day's memory conversation. */
    scribes: domainTable<string, { sessionId: string }>(z.object({ sessionId: z.string() })),
    /** Conversation id → its scribe. Kept across restarts: a restart is no reason for a new scribe. */
    conversations: domainTable<string, Scribe>(
      z.object({
        id: z.string(),
        parent: z.string(),
        tokens: z.number(),
        protocol: z.number().optional(),
      }),
    ),
    /** `consolidated` → the commit up to which the episodes are part of what is known. */
    marks: domainTable<string, { head: string }>(z.object({ head: z.string() })),
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

/** How long a scribe that goes on has for one turn before it is stopped. */
const SCRIBE_TURN_MS = 600_000

/** Which account of a scribe's work the scribes are given: 2 since they reply with entries and write no file. */
const SCRIBE_PROTOCOL = 2

/** The memory preset's tools that change files. */
const WRITING = ['edit', 'apply_patch']

/** How many files of episodes a conversation is told of when it starts: the newest. */
const RECENT = 40

/**
 * How many lines are put beside a new entry, and how many of them from one
 * file; and how many beside all the entries of a day, down to how few beside one.
 */
const COMPARED = 10
const PER_FILE = 2
const COMPARED_IN_ALL = 300
const COMPARED_LEAST = 3

/**
 * What is put beside what a conversation said: all the lines that have a name
 * from it that few lines have, then the lines that share the most words with
 * it. The measure of shared words grows with what was said: a question of a few
 * sentences reaches 30, "thanks" or a question about something else 13.
 */
const RECALL = { lines: 14, rare: 12, shared: 8, perFile: PER_FILE, floor: 15 }

/** How many lines that name today a conversation is shown. */
const TODAY = 20

/**
 * What the watcher reads: the newest characters of what happened before and of
 * what just happened, and of each tool call and result in them, out of the
 * newest events. A tool's result is often where a moment shows, so it reads more
 * of one than a scribe does; of what happened before, it needs to see what was
 * done, not all that it showed.
 */
const WATCHED = { before: 6000, now: 8000, toolArguments: 1000, toolResult: 2000, events: 200 }
const WATCHED_BEFORE = { toolArguments: 300, toolResult: 300 }

/** The events the watcher reads. */
const WATCHED_EVENTS: ReadonlySet<string> = new Set([
  'user/message',
  'assistant/message',
  'tool/result',
  'turn/end',
])

/** How long a step waits for the watcher, and how much it may write, thinking included. */
const WATCHER_MS = 10_000
const WATCHER_TOKENS = 2000

/** How many times one turn is given hunches at most. */
const HUNCHES_PER_TURN = 3

/** Git's name for a tree with nothing in it: what every file differs from. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

/** Services this plugin uses whose published declarations it cannot import. */
export interface Services {
  readonly sessionProjections: Projections
}

export async function apply(ctx: Context & Services, config: Config): Promise<void> {
  if ((config.scribeProvider === undefined) !== (config.scribeModel === undefined)) {
    throw new Error('memory: scribeProvider and scribeModel are set together')
  }
  if ((config.tidyProvider === undefined) !== (config.tidyModel === undefined)) {
    throw new Error('memory: tidyProvider and tidyModel are set together')
  }
  if ((config.watcherProvider === undefined) !== (config.watcherModel === undefined)) {
    throw new Error('memory: watcherProvider and watcherModel are set together')
  }
  /** The model that brings up hunches; without it, none is. */
  const watcher =
    config.watcherProvider === undefined || config.watcherModel === undefined
      ? undefined
      : { provider: config.watcherProvider, model: config.watcherModel }
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
  const scribes = store.table('conversations')
  const marks = store.table('marks')
  const projections = ctx.sessionProjections
  const warn = (what: string) => (error: unknown) =>
    ctx.logger.warn(`memory: ${what}: ${messageOf(error)}`)

  /** Memory as it is now: the commit, and the index at it. */
  let current = await snapshot()
  async function snapshot(): Promise<{ head: string; index: string | undefined }> {
    const head = await repository.head()
    return { head, index: await repository.show(head, INDEX_FILE) }
  }
  /** How the last turn of each memory conversation ended. */
  const endings = new Map<string, string>()
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

  /** The memory conversation's day at `at`: it starts at `dayStartsAt`, not at midnight. */
  const day = (at = Date.now()): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(at - config.dayStartsAt * 3_600_000))

  // What the scribes are given, kept for the tidying agent: a directory for each
  // day, a file for each conversation. Outside the memory directory, so that no
  // search of memory finds it and git does not hold it.
  const transcripts = config.transcripts ?? `${config.directory}-transcripts`
  await mkdir(transcripts, { recursive: true, mode: 0o700 })
  const keep = async (source: ScribeSource, transcript: string): Promise<void> => {
    const directory = join(transcripts, day())
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await appendFile(join(directory, `${source.sessionId}.md`), keptPart(source, transcript))
  }
  /** Remove the directories of the days more than `age` days ago from `root`; whether any was there. */
  const dropDaysBefore = async (root: string, age: number): Promise<boolean> => {
    const oldest = day(Date.now() - age * 86_400_000)
    const kept = await readdir(root).catch((error: unknown) => {
      if (isMissing(error)) return []
      throw error
    })
    const old = kept.filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry) && entry < oldest)
    for (const entry of old) await rm(join(root, entry), { recursive: true, force: true })
    return old.length > 0
  }
  const forget = async (): Promise<void> => {
    await dropDaysBefore(transcripts, config.transcriptDays)
  }
  /** The time of day, as an entry is headed. */
  const time = (): string =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())

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
    // The scribes of earlier memory conversations are not gone on with.
    const earlier = [...scribes.entries()].filter(([, scribe]) => scribe.parent !== sessionId)
    for (const [conversation] of earlier) await scribes.delete(conversation)
    return open(resolved.agent)
  }

  /** Give a memory conversation that never had a turn its one turn, which tidies the directory, and wait for it. */
  const opened = new Set<string>()
  const open = async (agent: Agent): Promise<Agent> => {
    if (opened.has(agent.id)) return agent
    opened.add(agent.id)
    const log = await ctx.sessionQuery.readSession(agent.session.id)
    if (log.events.some((event) => event.type === 'turn/start')) return agent
    await consolidate(agent, { holdsScribes: true })
    return agent
  }

  /**
   * Bring what is known up to date from the episodes it does not hold yet, in the
   * conversation of `agent`, which has had no turn, and wait for it: it is the only
   * writer meanwhile. Its changes are committed as its turns end, like those of
   * anyone working in the workspace.
   */
  const consolidate = async (
    agent: Agent,
    { holdsScribes }: { holdsScribes: boolean },
  ): Promise<void> => {
    const now = agent.model.current()
    const provider = config.tidyProvider ?? now?.provider
    const model = config.tidyModel ?? now?.model
    if (
      provider !== undefined &&
      model !== undefined &&
      (config.tidyModel !== undefined || config.tidyReasoningEffort !== undefined)
    ) {
      agent.model.select({
        provider,
        model,
        ...(config.tidyReasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(config.tidyReasoningEffort) }),
      })
    }
    await forget().catch(warn('dropping old transcripts'))
    const since = await consolidatedAt()
    const notes = await currentNotes()
    // Of a file that gained entries since then, only those are new.
    const added = (
      await Promise.all(
        (await unconsolidated()).map(async ({ file }) => {
          const text = notes[file] ?? ''
          const before = since === EMPTY_TREE ? undefined : await repository.show(since, file)
          const fresh = newEntries(before, text)
          const from = fresh.length < episodeEntries(text).length ? fresh[0]?.heading : undefined
          return { file, from, fresh }
        }),
      )
    ).filter(({ fresh }) => fresh.length > 0)
    const entries = added.flatMap(({ file, fresh }) =>
      fresh.map(({ heading, entry }) => ({ file, heading, entry })),
    )
    // On a day with many entries, each is set beside fewer lines: the best ones matter most.
    const beside = Math.max(
      COMPARED_LEAST,
      Math.min(COMPARED, Math.floor(COMPARED_IN_ALL / (entries.length || 1))),
    )
    const pairs: Compared[] = entries.map(({ file, heading, entry }) => {
      // An entry is set beside what the other files say, the other conversations' new episodes included.
      const others = Object.fromEntries(Object.entries(notes).filter(([other]) => other !== file))
      const lines = scored(entry, noteLines(others), beside, PER_FILE).map(({ line }) => line)
      return { file, heading, entry, lines }
    })
    /** Give the conversation a turn; whether it completed. */
    const ask = async (text: string): Promise<boolean> => {
      agent.followup(
        createUserMessage({ content: [{ type: 'text', text }], source: { kind: DAY_KIND } }),
      )
      await agent.whenIdle()
      return endings.get(agent.session.id) === 'completed'
    }
    const compared = pairs.length > 0 && (await ask(compareRequest(pairs)))
    const done = await ask(
      consolidateRequest(
        await memoryFile(GUIDANCE_FILE),
        { indexLines: config.indexLines, indexBytes: config.indexBytes },
        { directory: transcripts, days: config.transcriptDays },
        {
          added: added.map(({ file, from }) => ({ file, from })),
          compared,
          days: config.episodeDays,
          scribes: holdsScribes,
        },
      ),
    )
    await committing
    if (!done) {
      // The episodes stay new: the next time takes them up with its own.
      warn('bringing what is known up to date')(endings.get(agent.session.id) ?? 'no turn ended')
      return
    }
    await marks.put('consolidated', { head: current.head })
    if (await dropDaysBefore(join(config.directory, EPISODES), config.episodeDays)) {
      await commit(`Drop the episodes older than ${config.episodeDays} days\n`)
    }
  }

  /**
   * The notes that say how things stand now, by file: what is known, and the
   * episodes that are not part of it yet. The user's guidance is no note, and
   * the older episodes are what the known was made from: they are found by
   * searching, and would crowd out what is known if they were looked through
   * every time.
   */
  const currentNotes = async (): Promise<Record<string, string>> => {
    const fresh = new Set((await unconsolidated()).map(({ file }) => file))
    const files: Record<string, string> = {}
    for (const file of await repository.files()) {
      if (!file.endsWith('.md') || file === GUIDANCE_FILE) continue
      if (file.startsWith(`${EPISODES}/`) && !fresh.has(file)) continue
      const text = await memoryFile(file)
      if (text !== undefined) files[file] = text
    }
    return files
  }

  /** The commit up to which the episodes are part of what is known; the empty tree when none is. */
  const consolidatedAt = async (): Promise<string> => {
    // A mark that the history no longer has, as after it was rewritten, marks nothing.
    const mark = marks.get('consolidated')?.head
    return mark !== undefined && (await repository.has(mark)) ? mark : EMPTY_TREE
  }

  /** The files of episodes that what is known does not hold yet, oldest first, with their conversations' titles. */
  const unconsolidated = async (): Promise<Recent[]> => {
    const since = await consolidatedAt()
    const files = (await repository.changed(since, current.head)).filter((file) =>
      file.startsWith(`${EPISODES}/`),
    )
    const recent: Recent[] = []
    for (const file of files.toSorted()) {
      const text = await memoryFile(file)
      if (text !== undefined)
        recent.push({ file, title: text.split('\n', 1)[0]?.replace(/^# /, '') ?? '' })
    }
    return recent
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
    // A scribe only reads: the plugin writes its reply down.
    const deny = agent.session.header.origin === 'subagent' ? [...globals, ...WRITING] : globals
    if (deny.length === 0) return undefined
    hidden.set(
      agent.id,
      agent.ctx.effect(() => agent.ctx.tools.restrict({ deny }), 'memory: hidden tools'),
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
          // The day's memory conversation, or someone working on memory in its workspace.
          endings.set(session.id, event.data.reason.kind)
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
  let recording: Promise<void> = Promise.resolve()

  // The day's memory conversation starts when the day does, not at its first
  // conversation: a conversation that starts in the morning is given tidied memory.
  let started = day()
  const clock = setInterval(() => {
    const today = day()
    if (today === started) return
    started = today
    recording = recording
      .then(() => memoryConversation())
      .then(() => undefined)
      .catch(warn('starting the day'))
  }, 60_000)
  ctx.effect(() => () => clearInterval(clock), 'memory: day clock')

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
    await keep(source, transcript).catch(warn(`keeping what ${session.id} said`))

    // Until its turn completes, the conversation has no scribe to go on with.
    const known = scribes.get(session.id)
    if (known !== undefined) await scribes.delete(session.id)
    let scribe: { id: string; turn: ScribeTurn } | undefined
    if (
      known !== undefined &&
      known.parent === parent.id &&
      known.protocol === SCRIBE_PROTOCOL &&
      known.tokens <= config.continueTokens
    ) {
      try {
        const turn = await resume(parent, known.id, nextRequest(source, transcript))
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
    if (turn.ended !== 'completed') {
      // What a scribe did not finish is read again with the next turn, by a new scribe.
      warn(`noting ${session.id}`)(turn.ended)
      return
    }
    const entry = turn.reply.trim()
    if (entry !== '' && entry !== NOTHING) {
      const file = join(EPISODES, day(), `${session.id.replace(/^session-/, '').slice(0, 8)}.md`)
      const path = join(config.directory, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, episodeHead(source), { flag: 'wx' }).catch((error: unknown) => {
        if (!isExists(error)) throw error
      })
      await appendFile(path, episodeEntry(source, time(), entry))
      await commit(commitMessage(`Note ${file}: ${title ?? session.id}`, [session.id]))
    }
    await read.put(session.id, { seq: to })
    await scribes.put(session.id, {
      id,
      parent: parent.id,
      tokens: sizes.get(id) ?? 0,
      protocol: SCRIBE_PROTOCOL,
    })
  }

  /** What the watcher saw of a conversation, so that it is shown each event once. */
  interface Watched {
    /** The events it has not looked at, oldest first. */
    fresh: SessionEvent[]
    /** The newest of the events it looked at, oldest first. */
    seen: SessionEvent[]
    /** The hunches it brought up in the conversation. */
    shown: Set<string>
    /** The turn it last looked in, and how many times that turn was given hunches. */
    turn: number
    given: number
  }
  const watched = new Map<string, Watched>()

  /** Keep an event of a conversation for its watcher, once the watcher has looked at it. */
  const watchEvent = (session: Session, event: SessionEvent): void => {
    if (watcher === undefined || !WATCHED_EVENTS.has(event.type)) return
    const seen = watched.get(session.id)
    // Not looked at yet: the first look reads the conversation's log.
    if (seen === undefined) return
    if (event.type === 'user/message' && event.data.source.kind === 'user') {
      // What the user says reaches a step before it is logged: the watcher saw it there.
      seen.seen = newestEvents([...seen.seen, event])
      return
    }
    seen.fresh = newestEvents([...seen.fresh, event])
  }

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (remembered(session)) {
      watchEvent(session, event)
      if (event.type !== 'turn/end') return
      recording = recording
        .then(() => record(session, event.seq))
        .catch(warn(`recording ${session.id}`))
    } else if (inMemory(session)) {
      follow(session, event)
    }
  })

  // A memory conversation only holds scribes. DSH tells a conversation when a
  // subagent that was sent a message has finished; that alone starts no turn here.
  ctx.on(
    'agent/pre-step',
    ({ agent, messages }, next) => {
      const holdsScribes = [...days.entries()].some(([, held]) => held.sessionId === agent.id)
      const onlyNotices =
        messages.length > 0 && messages.every((m) => m.source.kind === 'subagent-settled')
      return holdsScribes && onlyNotices ? Promise.resolve({ kind: 'reject' }) : next()
    },
    { prepend: true },
  )

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
    const baseline = async (): Promise<UserMessage> => {
      const text = baselineText(
        config.directory,
        head,
        index === undefined
          ? undefined
          : indexHead(index, { lines: config.indexLines, bytes: config.indexBytes }),
        (await unconsolidated()).slice(-RECENT),
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
    const since = await repository.commits(given.version, head)
    if (since === undefined) return baseline()
    // What this conversation itself taught memory, it already knows.
    const others = since.some(
      (c) => c.sources.length === 0 || c.sources.some((id) => id !== session.id),
    )
    if (!others) return undefined
    const files = await repository.changed(given.version, head)
    if (files.length === 0) return undefined
    const text = updateText(given.version, head, files)
    return contextMessage(text, {
      kind: CONTEXT_KIND,
      version: head,
      form: 'notice',
      summary: `Memory changed in ${files.length} file(s)`,
    })
  }

  // The lines each conversation was shown beside what it said, so that none is shown twice,
  // and the day each was last shown the lines that name the day.
  const recalled = new Map<string, Set<string>>()
  const reminded = new Map<string, string>()
  ctx.on('agent/disposed', ({ agent }) => {
    recalled.delete(agent.session.id)
    reminded.delete(agent.session.id)
    watched.delete(agent.session.id)
  })

  /**
   * The notes a conversation is shown lines of. Hunches are brought up by the
   * watcher, and questions are for the user: neither is put beside what was said.
   */
  const shownNotes = async (): Promise<Record<string, string>> =>
    Object.fromEntries(
      Object.entries(await currentNotes()).filter(
        ([file]) =>
          file !== INDEX_FILE && file !== QUESTIONS_FILE && !file.startsWith(`${HUNCHES}/`),
      ),
    )

  /** The calendar day now, as a date. */
  const date = (): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

  /** The lines of memory, written before today, that name today: given the first time something is said in `session` that day. */
  const todayFor = async (session: Session): Promise<UserMessage | undefined> => {
    const today = date()
    if (reminded.get(session.id) === today) return undefined
    reminded.set(session.id, today)
    // What was noted today names today because it happened today, not because it was planned for it.
    const earlier = Object.entries(await shownNotes()).filter(
      ([file]) =>
        !file.startsWith(`${EPISODES}/${today}/`) && !file.startsWith(`${EPISODES}/${day()}/`),
    )
    const lines = naming(today, noteLines(Object.fromEntries(earlier))).slice(0, TODAY)
    if (lines.length === 0) return undefined
    const text = todayText(today, lines)
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: RECALL_KIND,
        form: 'notice',
        summary: `${lines.length} line(s) of memory name today`,
      },
    })
  }

  /**
   * The lines of memory most about what was just said in `session`, when any is
   * enough about it. The index is left out, since the conversation has it.
   */
  const recallFor = async (session: Session, said: string): Promise<UserMessage | undefined> => {
    const files = await shownNotes()
    const shownBefore = recalled.get(session.id) ?? new Set<string>()
    const lines: NoteLine[] = []
    for (const line of recall(said, noteLines(files), RECALL)) {
      const key = `${line.file}\n${line.text}`
      if (shownBefore.has(key)) continue
      shownBefore.add(key)
      lines.push(line)
    }
    if (lines.length === 0) return undefined
    recalled.set(session.id, shownBefore)
    const text = recallText(lines)
    return createUserMessage({
      content: [{ type: 'text', text }],
      source: {
        kind: RECALL_KIND,
        form: 'notice',
        summary: `Recalled ${lines.length} line(s) of memory`,
      },
    })
  }

  /** The hunches as they are now: read again only when memory changed. */
  let hunchesAt: { head: string; hunches: Hunch[] } | undefined
  const currentHunches = async (): Promise<Hunch[]> => {
    const { head } = current
    if (hunchesAt?.head === head) return hunchesAt.hunches
    const files: Record<string, string> = {}
    for (const file of await repository.files()) {
      if (!file.startsWith(`${HUNCHES}/`) || !file.endsWith('.md')) continue
      const text = await memoryFile(file)
      if (text !== undefined) files[file] = text
    }
    hunchesAt = { head, hunches: hunchesOf(files) }
    return hunchesAt.hunches
  }

  /** The watcher's reply to `request`, given every hunch. */
  const watch = async (
    model: { provider: string; model: string },
    hunches: readonly Hunch[],
    request: string,
    signal: AbortSignal,
  ): Promise<string> => {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(WATCHER_MS)])
    const call = await ctx.llm.prepareCall(
      {
        ...model,
        maxTokens: WATCHER_TOKENS,
        ...(config.watcherReasoningEffort === undefined
          ? {}
          : { reasoningEffort: ReasoningEffortId(config.watcherReasoningEffort) }),
      },
      deadline,
    )
    const options: GenerateOptions = {
      ...call.config,
      system: watcherSystem(hunches),
      messages: [
        createUserMessage({
          content: [{ type: 'text', text: request }],
          source: { kind: HUNCH_KIND, form: 'notice', summary: 'What the watcher was shown' },
        }),
      ],
      signal: deadline,
    }
    const assembler = new BlockAssembler()
    for await (const chunk of call.stream(options)) assembler.push(chunk)
    const { finish } = assembler
    if (finish.kind === 'error' || finish.kind === 'aborted')
      throw new Error(finish.failure.message)
    return assembler
      .blocks()
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n')
  }

  /**
   * What the watcher brings up before a step of `session`, if anything: it is
   * shown what was said before and what happened since it last looked, what
   * the user just said included. A watcher that fails or takes too long brings
   * up nothing, and the step goes on.
   */
  const hunchFor = async (
    session: Session,
    turn: number,
    said: string,
    signal: AbortSignal,
  ): Promise<UserMessage | undefined> => {
    if (watcher === undefined) return undefined
    try {
      let seen = watched.get(session.id)
      if (seen === undefined) {
        // The first look: what the conversation said before, and the hunches it was given then.
        const log = await ctx.sessionQuery.readSession(session.id)
        const shown = log.events.flatMap((event) =>
          event.type === 'user/message' && event.data.source.kind === HUNCH_KIND
            ? (event.data.source.files ??
              event.data.content.flatMap((block) =>
                block.type === 'text' ? (block.text.match(HUNCH_FILE) ?? []) : [],
              ))
            : [],
        )
        seen = {
          fresh: [],
          seen: newestEvents(log.events.filter((event) => WATCHED_EVENTS.has(event.type))),
          shown: new Set(shown),
          turn,
          given: 0,
        }
        watched.set(session.id, seen)
      }
      if (seen.turn !== turn) {
        seen.turn = turn
        seen.given = 0
      }
      const fresh = seen.fresh
      seen.fresh = []
      // What was done before, tool calls included: a moment already dealt with is not one to bring a hunch up for.
      const before = newest(renderTranscript(seen.seen, WATCHED_BEFORE), WATCHED.before)
      seen.seen = newestEvents([...seen.seen, ...fresh])
      const now = [renderTranscript(fresh, WATCHED), said === '' ? '' : `### User\n${said}`]
        .filter((part) => part !== '')
        .join('\n\n')
      if (now === '' || seen.given >= HUNCHES_PER_TURN) return undefined
      const hunches = await currentHunches()
      if (hunches.length === 0) return undefined
      const shown = seen.shown
      const happened = newest(now, WATCHED.now)
      const reply = await watch(
        watcher,
        hunches,
        watcherRequest(before, happened, [...shown]),
        signal,
      )
      const found = broughtUp(
        reply,
        hunches.filter(({ file }) => !shown.has(file)),
        happened,
      )
      if (found.length === 0) return undefined
      const files = found.map(({ file }) => file)
      for (const file of files) shown.add(file)
      seen.given += 1
      return createUserMessage({
        content: [{ type: 'text', text: hunchText(found) }],
        source: {
          kind: HUNCH_KIND,
          form: 'notice',
          summary: `Memory brought up ${files.join(', ')}`,
          files,
        },
      })
    } catch (error) {
      if (!signal.aborted) warn(`watching ${session.id}`)(error)
      return undefined
    }
  }

  ctx.on(
    'agent/pre-step',
    async ({ agent, turn, signal }, next) => {
      const decision = await next()
      if (decision.kind === 'reject' || signal.aborted) return decision
      if (!remembered(agent.session)) return decision
      try {
        const prompts = decision.messages.filter(
          (message) => message.role === 'user' && message.source.kind === 'user',
        )
        const said = prompts
          .flatMap((message) =>
            message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])),
          )
          .join('\n')
        const given = [
          await memoryFor(agent.session),
          said === '' ? undefined : await todayFor(agent.session),
          said === '' ? undefined : await recallFor(agent.session, said),
          await hunchFor(agent.session, turn, said, signal),
        ].filter((message) => message !== undefined)
        return given.length === 0
          ? decision
          : { ...decision, messages: [...decision.messages, ...given] }
      } catch (error) {
        warn(`giving memory to ${agent.session.id}`)(error)
        return decision
      }
    },
    { prepend: true },
  )

  // Dreaming on demand: what the night does, now, in a conversation of its own in
  // the memory workspace, so that the day's scribes stay where they are. A day
  // brings much or little whenever it is taken up, and what was taken up is
  // marked, so the night takes up only what came after.
  let dreaming = false
  const dream = async (): Promise<void> => {
    const { id } = await workspace()
    const { sessionId } = await ctx.sessionController.create({
      workspaceId: id,
      agentPreset: config.agentPreset,
    })
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    ctx.get('sessionTitle')?.rename(resolved.agent.session, `Memory · dream · ${date()} ${time()}`)
    await consolidate(resolved.agent, { holdsScribes: false })
  }
  ctx.effect(
    () =>
      ctx.commands.register({
        name: 'dream',
        description: 'Bring what memory knows up to date now, as each night does',
        handler: async ({ rawInput }) => {
          if (rawInput.trim() !== '') return { kind: 'error', text: 'Usage: /dream (no arguments)' }
          if (dreaming)
            return { kind: 'error', text: 'Memory is already being brought up to date.' }
          const added = (await unconsolidated()).length
          if (added === 0) {
            return {
              kind: 'success',
              text: 'No episode is new since memory was last brought up to date.',
            }
          }
          dreaming = true
          // One writer at a time: it waits for the scribe at work, and the scribes wait for it.
          recording = recording
            .then(() => dream())
            .catch(warn('dreaming'))
            .finally(() => {
              dreaming = false
            })
          return {
            kind: 'success',
            text: `Bringing ${added} file(s) of episodes into what memory knows, in a Memory · dream conversation of the memory workspace. Scribes wait until it is done.`,
          }
        },
      }),
    'memory: /dream',
  )
}

function contextMessage(
  text: string,
  source: { kind: 'langify-memory'; version: string; baseline?: true } & ContextFormed,
): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }], source })
}

/** How a hunch's file is named where it is brought up. */
const HUNCH_FILE = new RegExp(`${HUNCHES}/[^\\s)]+\\.md`, 'g')

/** The newest of `events` that the watcher keeps. */
function newestEvents(events: readonly SessionEvent[]): SessionEvent[] {
  return events.slice(-WATCHED.events)
}

/** The end of `text`, at most `limit` characters of it. */
function newest(text: string, limit: number): string {
  return text.length <= limit ? text : `…${text.slice(-limit)}`
}

function isExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Host: keeps a memory directory up to date from every conversation.
//
// When a conversation's turn ends, the part of it the scribe has not read yet
// goes to the day's scribe conversation, in the memory directory's workspace.
// When a turn ends in any conversation in that workspace (the scribe, or anyone
// working on memory there), its changes become one commit whose message is the
// reply that ended the turn.
/// <reference types="@deepseek-ai/dsh-api-session-controller" />
/// <reference types="@deepseek-ai/dsh-session-query" />
/// <reference types="@deepseek-ai/dsh-session-title" />
import { realpath } from 'node:fs/promises'
import { sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionEvent } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { AGENTS_MD, commitMessage, MEMORY_MD, scribeRequest } from '../scribe.ts'
import { renderTranscript } from '../transcript.ts'
import { Repository } from './repository.ts'

export const name = 'langify-memory'

const SOURCE_KIND = 'langify-memory'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A request to the scribe, naming the conversation it is about. */
    'langify-memory': { kind: 'langify-memory'; sessionId: string }
  }
}

export const inject: readonly string[] = [
  'sessionQuery',
  'sessionController',
  'workspaceRegistry',
  'storageDomain',
]

export interface Config {
  directory: string
  git: string
  timeZone?: string
  toolArguments: number
  toolResult: number
}

export const Config: Schema<Config> = Schema.object({
  directory: Schema.string().required().description('The memory directory.'),
  git: Schema.string()
    .default('git')
    .description('The git executable: a name looked up on PATH, or a path.'),
  timeZone: Schema.string().description(
    "The IANA time zone whose days each get a new scribe conversation. Without it, the host's.",
  ),
  toolArguments: Schema.natural()
    .default(300)
    .description("Characters of a tool call's arguments the scribe reads."),
  toolResult: Schema.natural()
    .default(500)
    .description('Characters of a tool result the scribe reads.'),
})

/** What the plugin keeps: how far each conversation has been read, and each day's scribe. */
const domain = defineDomain({
  name: 'langify-memory',
  version: 1,
  tables: {
    /** Conversation id → the last event handed to the scribe. */
    read: domainTable<string, { seq: number }>(z.object({ seq: z.number() })),
    /** Day (YYYY-MM-DD) → that day's scribe conversation. */
    scribes: domainTable<string, { sessionId: string }>(z.object({ sessionId: z.string() })),
  },
})

/** A turn of a memory conversation, followed until it ends. */
interface MemoryTurn {
  readonly sources: Set<string>
  reply: string
}

export async function apply(ctx: Context, config: Config): Promise<void> {
  const repository = new Repository(config.git, config.directory)
  await repository.init({ 'AGENTS.md': AGENTS_MD, 'MEMORY.md': MEMORY_MD })
  const directories = [config.directory, await realpath(config.directory)]
  const store = await ctx.storageDomain.open(domain)
  ctx.effect(() => () => store.close(), 'memory: storage')
  const read = store.table('read')
  const scribes = store.table('scribes')
  const warn = (what: string) => (error: unknown) =>
    ctx.logger.warn(`memory: ${what}: ${messageOf(error)}`)

  const inMemory = (session: Session): boolean => {
    const { cwd } = session.header
    return cwd !== undefined && directories.some((d) => cwd === d || cwd.startsWith(d + sep))
  }
  const day = (): string =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())

  const workspace = async (): Promise<Workspace> =>
    (await ctx.workspaceRegistry.resolveByPath(config.directory)) ??
    ctx.workspaceRegistry.create(config.directory, 'memory')
  await workspace()

  /** Today's scribe, started when there is none or it can no longer be opened. */
  const scribe = async (): Promise<Agent> => {
    const today = day()
    const known = scribes.get(today)
    if (known !== undefined) {
      const resolved = await ctx.sessionController.resolveAgent(SessionId(known.sessionId))
      if ('agent' in resolved) return resolved.agent
      warn(`opening the scribe ${known.sessionId}`)(resolved.error)
    }
    const { id } = await workspace()
    const { sessionId } = await ctx.sessionController.create({ workspaceId: id })
    await scribes.put(today, { sessionId })
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw resolved.error
    try {
      ctx.get('sessionTitle')?.rename(resolved.agent.session, `Memory scribe · ${today}`)
    } catch (error) {
      warn('naming the scribe')(error)
    }
    return resolved.agent
  }

  // One conversation at a time, in the order their turns ended.
  let handing: Promise<void> = Promise.resolve()
  const hand = async (session: Session, to: number): Promise<void> => {
    const log = await ctx.sessionQuery.readSession(session.id)
    const from = Math.max((read.get(session.id)?.seq ?? -1) + 1, log.inheritedEventCount)
    const events = log.events.filter((event) => event.seq >= from && event.seq <= to)
    const transcript = renderTranscript(events, {
      toolArguments: config.toolArguments,
      toolResult: config.toolResult,
    })
    if (transcript !== '') {
      const text = scribeRequest(
        {
          sessionId: session.id,
          title: ctx.get('sessionTitle')?.get(session)?.title,
          cwd: session.header.cwd,
          from,
          to,
        },
        transcript,
      )
      ;(await scribe()).followup(
        createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: SOURCE_KIND, sessionId: session.id },
        }),
      )
    }
    await read.put(session.id, { seq: to })
  }

  // Commits one at a time, in the order the turns ended.
  let committing: Promise<void> = Promise.resolve()
  const turns = new Map<string, MemoryTurn>()

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (!inMemory(session)) {
      if (event.type !== 'turn/end' || session.header.origin === 'subagent') return
      handing = handing.then(() => hand(session, event.seq)).catch(warn(`reading ${session.id}`))
      return
    }
    switch (event.type) {
      case 'turn/start':
        turns.set(session.id, { sources: new Set(), reply: '' })
        break
      case 'user/message': {
        const { source } = event.data
        if (source.kind === SOURCE_KIND) turns.get(session.id)?.sources.add(source.sessionId)
        break
      }
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
        const turn = turns.get(session.id)
        turns.delete(session.id)
        const message = commitMessage(turn?.reply ?? '', [...(turn?.sources ?? [])])
        committing = committing
          .then(() => repository.commit(message))
          .then(() => undefined)
          .catch(warn('committing'))
        break
      }
      default:
        break
    }
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

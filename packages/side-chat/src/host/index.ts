// Host half: forks the session into a side chat, marks the fork with the
// side-chat context in its inbox, and projects that mark to the browser.
import type { Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import {
  clientRequestSchema,
  type ConnectionFetchRoute,
  type ConnectionRpcResult,
  type HostConnectionHandle,
  type ServerResponse,
} from '@deepseek-ai/dsh-client-connection'
import { createUserMessage, type ContextFormed, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import {
  PROJECTION_KEY,
  RPC_CHANNEL,
  RPC_METHOD,
  createRequestSchema,
  type CreateRequest,
  type CreateResponse,
  type ErrorCode,
} from '../rpc.ts'

export const name = 'langify-side-chat'

const SOURCE_KIND = 'langify-side-chat'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'langify-side-chat': { kind: 'langify-side-chat' } & ContextFormed
  }
}

/**
 * One projection unit, after `ProjectionDefinition` in
 * @deepseek-ai/dsh-session-projection, whose published declarations fail a strict lib check.
 */
export interface ProjectionDefinition<S> {
  readonly key: string
  readonly stateVersion: number
  readonly stateSchema: z.ZodType<S>
  readonly init: (header: unknown, inheritedEventCount: number) => S
  readonly apply: (state: S, event: SessionEvent) => S
  readonly wire: { readonly viewSchema: z.ZodType; readonly view: (state: S) => unknown }
}

/** The DSH host services this plugin injects. */
export interface Services {
  readonly connection: HostConnectionHandle
  readonly sessionController: SessionController
  readonly sessionProjections: {
    register<S>(definition: ProjectionDefinition<S>): () => void
  }
}

export const inject: readonly (keyof Services)[] = [
  'connection',
  'sessionController',
  'sessionProjections',
]

/** Model-facing; the Chat view hides context messages, so the user never sees it. */
export const SIDE_CHAT_CONTEXT = `This is a side chat. The user opened it beside the conversation above to ask questions about it without interrupting it. The conversation above is a copy you share as background; your replies here never reach it.

- Answer the user's questions in this side chat; do not resume or continue the main task.
- Investigate as needed, but do not change files, run state-changing commands, or take other actions with side effects unless the user explicitly asks for them in this side chat.
- Keep answers short and to the point.`

class SideChatError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

export function apply(ctx: Context & Services): void {
  ctx.effect(() => ctx.sessionProjections.register(sideChatProjection), 'side-chat: projection')

  async function create(request: CreateRequest): Promise<CreateResponse> {
    let sessionId: SessionId
    try {
      ;({ sessionId } = await ctx.sessionController.fork({
        sessionId: SessionId(request.sessionId),
      }))
    } catch (error) {
      throw new SideChatError('fork_failed', messageOf(error), { cause: error })
    }
    // The context waits in the fork's inbox for its first step. The inbox is
    // logged at once, so the fork is a side chat from now on, across restarts.
    const resolved = await ctx.sessionController.resolveAgent(sessionId)
    if ('error' in resolved) throw new SideChatError('fork_failed', resolved.error.message)
    resolved.agent.inject(sideChatContext())
    // A fork keeps its source's title; the side chat is usable without its own.
    await ctx.sessionController
      .rename({ sessionId: SessionId(sessionId), title: request.title })
      .catch((error: unknown) => ctx.logger.warn(`side-chat: rename failed: ${messageOf(error)}`))
    return { sessionId }
  }

  const route: ConnectionFetchRoute = {
    path: `${RPC_CHANNEL}/${RPC_METHOD}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      // JSON only, as DSH's own RPC: a cross-site form cannot send it.
      const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (type !== 'application/json') return new Response('JSON required', { status: 415 })
      const body: unknown = await request.json().catch(() => undefined)
      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success || envelope.data.method !== RPC_METHOD) {
        return new Response('Invalid RPC envelope', { status: 400 })
      }
      const response: ServerResponse = {
        type: 'server-response',
        rpcId: envelope.data.rpcId,
        result: await answer(envelope.data.payload),
      }
      return Response.json(response)
    },
  }

  async function answer(payload: unknown): Promise<ConnectionRpcResult<unknown>> {
    try {
      const request = createRequestSchema.safeParse(payload)
      if (!request.success) {
        throw new SideChatError('invalid_request', z.prettifyError(request.error))
      }
      return { ok: true, value: await create(request.data) }
    } catch (error) {
      const { code, message } =
        error instanceof SideChatError
          ? error
          : { code: 'internal_error', message: messageOf(error) }
      return { ok: false, error: { code, message, details: {} } }
    }
  }

  ctx.effect(() => ctx.connection.fetch.register(route), `side-chat: ${route.path}`)
}

function sideChatContext(): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: SIDE_CHAT_CONTEXT }],
    source: { kind: SOURCE_KIND, form: 'instructions' },
  })
}

/** Fold state: the fork-inherited prefix is not the session's own. */
interface SideChatState {
  readonly inherited: number
  readonly sideChat: boolean
}

/**
 * `langifySideChat`: whether the session's own log holds the side-chat context,
 * from the moment it enters the inbox. A Fork of a side chat inherits the
 * context but is not one.
 */
export const sideChatProjection: ProjectionDefinition<SideChatState> = {
  key: PROJECTION_KEY,
  stateVersion: 1,
  stateSchema: z.strictObject({ inherited: z.int().nonnegative(), sideChat: z.boolean() }),
  init: (_header, inheritedEventCount) => ({ inherited: inheritedEventCount, sideChat: false }),
  apply: (state, event) =>
    state.sideChat || event.seq < state.inherited || !carriesContext(event)
      ? state
      : { ...state, sideChat: true },
  wire: { viewSchema: z.boolean(), view: (state) => state.sideChat },
}

const isContext = (message: UserMessage): boolean => message.source.kind === SOURCE_KIND

function carriesContext(event: SessionEvent): boolean {
  if (event.type === 'user/message') return isContext(event.data)
  if (event.type === 'agent/inbox/spliced') return event.data.inserted.some(isContext)
  return false
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

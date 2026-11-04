// Host half: lists the recipes of the justfile `just` finds from a session's
// working folder. Running a recipe happens in the browser, in a terminal tab.
import { execFile } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import {
  clientRequestSchema,
  type ConnectionFetchRoute,
  type ConnectionRpcResult,
  type HostConnectionHandle,
  type ServerResponse,
} from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import { z } from 'zod'
import {
  RPC_CHANNEL,
  RPC_METHOD,
  listRequestSchema,
  type ErrorCode,
  type ListResponse,
  type Parameter,
  type Recipe,
} from '../rpc.ts'

export const name = 'langify-tasks'

/** The DSH host services this plugin injects. */
export interface Services {
  readonly connection: HostConnectionHandle
  readonly sessionController: SessionController
  readonly workingDirectory: WorkingDirectoryService
}

export const inject: readonly (keyof Services)[] = [
  'connection',
  'sessionController',
  'workingDirectory',
]

const JUST_TIMEOUT_MS = 10_000
const JUST_MAX_OUTPUT = 8 * 1024 * 1024

class TasksError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

export function apply(ctx: Context & Services): void {
  async function list(sessionId: string): Promise<ListResponse> {
    const resolved = await ctx.sessionController.resolveAgent(SessionId(sessionId))
    if ('error' in resolved) throw new TasksError('session_not_found', resolved.error.message)
    // The folder the session's terminals start in, created if it was removed.
    const cwd = await ctx.workingDirectory.ensure(resolved.agent)
    return { cwd, ...parseDump(await dump(cwd)) }
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
      const request = listRequestSchema.safeParse(payload)
      if (!request.success) throw new TasksError('invalid_request', z.prettifyError(request.error))
      return { ok: true, value: await list(request.data.sessionId) }
    } catch (error) {
      const { code, message } =
        error instanceof TasksError ? error : { code: 'internal_error', message: messageOf(error) }
      return { ok: false, error: { code, message, details: {} } }
    }
  }

  ctx.effect(() => ctx.connection.fetch.register(route), `tasks: ${route.path}`)
}

/** `just`'s JSON dump of the justfile it finds from `cwd`; `undefined` when there is none. */
function dump(cwd: string): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    execFile(
      'just',
      ['--dump', '--dump-format', 'json'],
      { cwd, timeout: JUST_TIMEOUT_MS, maxBuffer: JUST_MAX_OUTPUT },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout)
        if (error.code === 'ENOENT') {
          return reject(new TasksError('just_not_found', '`just` is not installed on the host'))
        }
        if (/no justfile found/i.test(stderr)) return resolve(undefined)
        reject(new TasksError('just_failed', stderr.trim() || error.message, { cause: error }))
      },
    )
  })
}

// The part of `just --dump --dump-format json` this plugin reads. Fields that
// older `just` releases lack are optional.
const dumpSchema = z.object({
  source: z.string().nullish(),
  recipes: z.record(
    z.string(),
    z.object({
      name: z.string(),
      doc: z.string().nullish(),
      private: z.boolean(),
      parameters: z.array(
        z.object({
          name: z.string(),
          kind: z.enum(['singular', 'star', 'plus']),
          default: z.unknown(),
          help: z.string().nullish(),
          long: z.string().nullish(),
          short: z.string().nullish(),
          value: z.unknown(),
        }),
      ),
    }),
  ),
})

/** The listing for `just`'s dump, or for no justfile when `output` is `undefined`. */
export function parseDump(output: string | undefined): Omit<ListResponse, 'cwd'> {
  if (output === undefined) return { justfile: null, recipes: [] }
  let json: unknown
  try {
    json = JSON.parse(output)
  } catch (error) {
    throw new TasksError('just_failed', 'just printed invalid JSON', { cause: error })
  }
  const parsed = dumpSchema.safeParse(json)
  if (!parsed.success) throw new TasksError('just_failed', z.prettifyError(parsed.error))
  const recipes: Recipe[] = Object.values(parsed.data.recipes)
    .filter((recipe) => !recipe.private)
    .map((recipe) => ({
      name: recipe.name,
      doc: recipe.doc ?? null,
      parameters: recipe.parameters.map((p): Parameter => ({
        name: p.name,
        kind: p.kind,
        default: typeof p.default === 'string' ? p.default : null,
        optional: p.default != null || p.kind === 'star' || p.value != null,
        help: p.help ?? null,
        option: p.long != null ? `--${p.long}` : p.short != null ? `-${p.short}` : null,
        flag: p.value != null,
      })),
    }))
  return { justfile: parsed.data.source ?? null, recipes }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

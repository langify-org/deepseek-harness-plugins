/**
 * @langify-org/dsh-workbench — host half.
 *
 * Serves the browser half through exact routes below `/api`, the same way DSH's
 * own packages do, so every request passes DSH's Host/Origin checks and browser
 * authentication. Prototype: see DESIGN.md.
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-workspace'
import { defaultRoot } from './names.ts'
import { endpointPath, ENDPOINTS, type ApiResult, type CreateRequest, type Endpoint, type ListRequest, type RemoveRequest } from './protocol.ts'
import { WorkbenchStore } from './state.ts'
import { WorkbenchError, Workbenches, type Registry } from './workbenches.ts'

export const name = 'langify-workbench'
export const inject = ['connection', 'workspaceRegistry']

export interface ConfigInput {
  root?: string
  branchPrefix?: string
}

export const Config: Schema<ConfigInput> = Schema.object({
  root: Schema.string().description('Where workbenches are made. Defaults to $XDG_DATA_HOME/dsh-workbench.'),
  branchPrefix: Schema.string().default('wb/').description('Prefix of the git branch each workbench gets.'),
})

/** The part of DSH's host `ctx.connection` this plugin uses (`@deepseek-ai/dsh-client-connection`). */
interface HostConnection {
  readonly fetch: {
    register(route: {
      path: string
      methods: readonly ('GET' | 'HEAD' | 'POST')[]
      requestBody: 'buffered' | 'streaming'
      fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

type DshHomePath = (...segments: string[]) => string

export function apply(ctx: Context, rawConfig?: unknown): void {
  const config = resolveConfig(rawConfig)
  const dshHomePath = ctx.get('dshHomePath') as DshHomePath | undefined
  const stateDir = dshHomePath !== undefined ? dshHomePath('langify-workbench') : join(process.env.DSH_HOME ?? '', 'langify-workbench')
  const workbenches = new Workbenches({
    registry: ctx.workspaceRegistry as unknown as Registry,
    store: new WorkbenchStore(join(stateDir, 'workbenches.json')),
    root: config.root ?? defaultRoot(),
    branchPrefix: config.branchPrefix,
    sessionCwd: (sessionId) => ctx.get('sessions')?.get(sessionId as SessionId)?.header.cwd,
    closeTerminals: (sessionId) => closeTerminals(ctx, sessionId),
  })
  const connection = (ctx as unknown as { connection: HostConnection }).connection

  const handlers: Record<Endpoint, (payload: Record<string, unknown>) => Promise<unknown>> = {
    list: (payload) => workbenches.list(payload as ListRequest),
    create: (payload) => workbenches.create(payload as unknown as CreateRequest),
    remove: (payload) => workbenches.remove(payload as unknown as RemoveRequest),
  }
  // Each registration is an effect of this plugin's context and goes away when the plugin unloads.
  for (const endpoint of ENDPOINTS) {
    connection.fetch.register({
      path: endpointPath(endpoint),
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        let result: ApiResult<unknown>
        try {
          const payload = asRecord(await request.json().catch(() => ({})))
          result = { ok: true, value: await handlers[endpoint](payload) }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (!(error instanceof WorkbenchError)) process.stderr.write(`[langify-workbench] ${endpoint} failed: ${message}\n`)
          result = { ok: false, error: { code: error instanceof WorkbenchError ? 'workbench/refused' : 'workbench/failed', message } }
        }
        return Response.json(result, { headers: { 'cache-control': 'no-store' } })
      },
    })
  }
}

/** The parts of DSH's `ctx.terminalController` and `ctx.agents` used to close a Session's terminals. */
interface TerminalControllerLike {
  list(sessionId: string): readonly { id: string }[]
  close(agent: unknown, id: string): Promise<void>
}
interface AgentsLike {
  get(sessionId: string): unknown
}

/** Close a Session's user terminals through DSH's terminal controller, when both it and the live Agent exist. */
async function closeTerminals(ctx: Context, sessionId: string): Promise<number> {
  const terminals = ctx.get('terminalController' as never) as TerminalControllerLike | undefined
  const agent = (ctx.get('agents' as never) as AgentsLike | undefined)?.get(sessionId)
  if (terminals === undefined || agent === undefined) return 0
  let closed = 0
  for (const terminal of terminals.list(sessionId)) {
    try {
      await terminals.close(agent, terminal.id)
      closed++
    } catch (error) {
      process.stderr.write(`[langify-workbench] could not close terminal ${terminal.id} of ${sessionId}: ${String(error)}\n`)
    }
  }
  return closed
}

function resolveConfig(raw: unknown): { root?: string; branchPrefix: string } {
  const input = (raw ?? {}) as ConfigInput
  if (input.root !== undefined && (typeof input.root !== 'string' || input.root === '')) {
    throw new Error('langify-workbench: root must be a non-empty string')
  }
  const branchPrefix = input.branchPrefix ?? 'wb/'
  if (typeof branchPrefix !== 'string') throw new Error('langify-workbench: branchPrefix must be a string')
  return { ...(input.root !== undefined ? { root: input.root } : {}), branchPrefix }
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
}

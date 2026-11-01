// RPC endpoints the page calls; see ../rpc.ts for the contract.
import { realpath } from 'node:fs/promises'
import {
  clientRequestSchema,
  type ConnectionFetchRoute,
  type ConnectionRpcResult,
  type ServerResponse,
} from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { z } from 'zod'
import { BINDING_FRAGMENT } from '../bridge-protocol.ts'
import {
  METHODS,
  RPC_CHANNEL,
  RPC_PREFIX,
  requestSchemas,
  type Ingress,
  type Method,
  type Requests,
  type Responses,
} from '../rpc.ts'
import type { Bridge } from './bridge.ts'
import type { CodeServer } from './code-server.ts'
import { CodeServerError } from './errors.ts'
import type { Services } from './services.ts'

type Handlers = {
  readonly [M in Method]: (request: Requests[M], signal: AbortSignal) => Promise<Responses[M]>
}

/** A session's current working folder, and the folder its relative file links belong to. */
interface SessionFolders {
  readonly cwd: string
  readonly original: string
}

/** Each ingress's address for the editor, ending in a slash. */
export type EditorBases = { readonly [I in Ingress]: () => Promise<string> }

/**
 * One exact route per method on DSH's shared RPC channel. DSH authenticates the
 * browser before a request reaches these routes.
 */
export function rpcRoutes(
  services: Services,
  bridge: Bridge,
  codeServer: CodeServer,
  editors: EditorBases,
): ConnectionFetchRoute[] {
  const handlers: Handlers = {
    async create({ sessionId, ownerId, ingress }, signal) {
      const { cwd } = await sessionFolders(services, sessionId, signal)
      const folder = await localPath(services, cwd, cwd, 'directory', signal)
      // Start first: the window must load before its binding's connect timeout runs out.
      await codeServer.ensure()
      await codeServer.syncExtension()
      const base = await editors[ingress]()
      signal.throwIfAborted()
      const bindingId = bridge.create(sessionId, ownerId, folder)
      return { bindingId, cwd: folder, url: editorUrl(base, bindingId, folder) }
    },
    async watch({ sessionId, bindingId, revision }, signal) {
      // The page watches continuously, so this is where a changed working folder is noticed.
      const { cwd } = await sessionFolders(services, sessionId, signal)
      bridge.announceCwd(sessionId, bindingId, await realpath(cwd).catch(() => cwd))
      return bridge.watch(sessionId, bindingId, revision, signal)
    },
    async close({ sessionId, bindingId }) {
      bridge.close(sessionId, bindingId)
      return { state: 'closed' }
    },
    async open({ sessionId, bindingId, address, line = 1 }, signal) {
      let path: string
      try {
        path = await filePath(services, sessionId, address, signal)
      } catch (error) {
        // Found before the editor was asked: show it there, where the user is looking.
        bridge.report(sessionId, bindingId, asCodeServerError(error))
        throw error
      }
      return bridge.open(sessionId, bindingId, { path, line })
    },
  }

  async function dispatch<M extends Method>(
    method: M,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<Responses[M]> {
    const request = requestSchemas[method].safeParse(payload)
    if (!request.success)
      throw new CodeServerError('invalid_request', z.prettifyError(request.error))
    return handlers[method](request.data, signal)
  }

  async function answer(
    method: Method,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<ConnectionRpcResult<unknown>> {
    try {
      return { ok: true, value: await dispatch(method, payload, signal) }
    } catch (error) {
      const { code, message } = asCodeServerError(error)
      return { ok: false, error: { code, message, details: {} } }
    }
  }

  return METHODS.map((method) => ({
    path: `${RPC_CHANNEL}/${RPC_PREFIX}${method}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      // JSON only, as DSH's own RPC: a cross-site form cannot send it.
      const type = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (type !== 'application/json') return new Response('JSON required', { status: 415 })
      const body: unknown = await request.json().catch(() => undefined)
      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success || envelope.data.method !== `${RPC_PREFIX}${method}`) {
        return new Response('Invalid RPC envelope', { status: 400 })
      }
      const response: ServerResponse = {
        type: 'server-response',
        rpcId: envelope.data.rpcId,
        result: await answer(method, envelope.data.payload, request.signal),
      }
      return Response.json(response)
    },
  }))
}

/** The iframe URL; its fragment tells the window's extension its binding. */
function editorUrl(base: string, bindingId: string, cwd: string): string {
  const query = new URLSearchParams({ folder: cwd })
  return `${base}?${query.toString()}#${BINDING_FRAGMENT}=${bindingId}`
}

function asCodeServerError(error: unknown): CodeServerError {
  if (error instanceof CodeServerError) return error
  return new CodeServerError(
    'internal_error',
    error instanceof Error ? error.message : String(error),
    {
      cause: error,
    },
  )
}

/** The local file a `dsh-resource://file/...` address names. */
async function filePath(
  services: Services,
  sessionId: string,
  address: string,
  signal: AbortSignal,
): Promise<string> {
  const file = parseFileAddress(address)
  if (file === undefined) throw new CodeServerError('not_a_local_file', 'Not a local file link')
  // A relative link belongs to the folder its session started in, not to the current one.
  const owner = file.scope === 'session' ? file.sessionId : sessionId
  const { original } = await sessionFolders(services, owner, signal)
  return localPath(services, file.path, original, 'file', signal)
}

async function sessionFolders(
  services: Services,
  id: string,
  signal: AbortSignal,
): Promise<SessionFolders> {
  const sessionId = SessionId(id)
  const fallback = services.workingDirectory.defaultDirectory
  const live = services.sessions.get(sessionId)
  if (live !== undefined) {
    return { cwd: services.workingDirectory.get(live), original: live.header.cwd ?? fallback }
  }
  const projection = await services.sessionController.projections({ sessionId }, signal)
  if (projection === null) throw new CodeServerError('session_not_found', 'No such session')
  if (projection.kind !== 'sequenced') {
    throw new CodeServerError(
      'session_migration_required',
      'Open the conversation once to migrate it',
    )
  }
  const saved = await services.sessionPersistence.stat(sessionId, { signal })
  if (saved === undefined) throw new CodeServerError('session_not_found', 'No such session')
  const original = saved.header.cwd ?? fallback
  return { cwd: projection.values.workingDirectory ?? original, original }
}

/** Resolve a path through DSH's file system and require it on this host, canonicalized. */
async function localPath(
  services: Services,
  path: string,
  base: string,
  type: 'file' | 'directory',
  signal: AbortSignal,
): Promise<string> {
  const target = await services.fs.resolve(path, { cwd: base, signal })
  const info = await services.fs.stat(target, signal)
  if (info?.type !== type) {
    throw new CodeServerError(
      type === 'file' ? 'not_a_file' : 'not_a_directory',
      `${path} is not a ${type}`,
    )
  }
  const processPath = services.fs.processPath(target)
  // code-server runs here; a sandboxed or remote file system names other files.
  if (services.fs.processPathFromHostPath(processPath) !== processPath) {
    throw new CodeServerError('different_host', 'The session runs on another file system')
  }
  return realpath(processPath)
}

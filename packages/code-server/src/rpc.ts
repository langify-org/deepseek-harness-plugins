// The RPC contract between the browser page and the host plugin. It is shared
// by both halves, so it stays free of Node and DOM APIs.
import { z } from 'zod'

/** DSH's shared RPC channel, and the prefix of the endpoints this plugin owns on it. */
export const RPC_CHANNEL = '/api'
export const RPC_PREFIX = 'langify-code-server/'

/** A line in a text file; lines are 1-based. */
export interface FileLocation {
  readonly path: string
  readonly line: number
}

/**
 * Lifecycle of one editor window's connection. Only `pending` and `ready` are
 * live; the others are final and the page creates a new binding to continue.
 */
export type BindingState = 'pending' | 'ready' | 'disconnected' | 'expired' | 'closed'

/**
 * Why the extension could not open a file. `outcome_unknown` means the editor
 * was already asked and may still show the file later.
 */
export const OPEN_ERROR_CODES = [
  'invalid_path',
  'deadline_exceeded',
  'outcome_unknown',
  'open_failed',
  'show_failed',
] as const
export type OpenErrorCode = (typeof OPEN_ERROR_CODES)[number]

/** Failures the host finds itself. */
export const HOST_ERROR_CODES = [
  'invalid_request',
  'session_not_found',
  'session_migration_required',
  'not_a_directory',
  'not_a_file',
  'not_a_local_file',
  'different_host',
  'code_server_not_found',
  'code_server_failed',
  'unknown_binding',
  'not_ready',
  'binding_disconnected',
  'binding_expired',
  'binding_closed',
  'internal_error',
] as const

/** Every failure code; each one has a translated message. */
export type ErrorCode = OpenErrorCode | (typeof HOST_ERROR_CODES)[number]

export interface Requests {
  /** Prepare a new editor window for the session's working folder. */
  create: { readonly sessionId: string; readonly ownerId: string }
  /**
   * Keep the binding alive and wait, up to 20 seconds, for it to move past
   * `revision`: -1 answers at once.
   */
  watch: { readonly sessionId: string; readonly bindingId: string; readonly revision: number }
  close: { readonly sessionId: string; readonly bindingId: string }
  /** Open a `dsh-resource://file/...` address in the window, at `line` when given. */
  open: {
    readonly sessionId: string
    readonly bindingId: string
    readonly address: string
    readonly line?: number | undefined
  }
}

export interface Responses {
  /** `url` is relative to the DSH page and loads the window into an iframe. */
  create: { readonly bindingId: string; readonly cwd: string; readonly url: string }
  /** `reconnect`: the editor asked for a new window, after handling unsaved changes itself. */
  watch: { readonly state: BindingState; readonly revision: number; readonly reconnect: boolean }
  close: { readonly state: 'closed' }
  open: FileLocation
}

export type Method = keyof Requests & keyof Responses

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.includes('\0'))
const position = z.int().min(1).max(1_000_000)
const binding = { sessionId: id, bindingId: z.uuid() }

export const requestSchemas: { readonly [M in Method]: z.ZodType<Requests[M]> } = {
  create: z.strictObject({ sessionId: id, ownerId: id }),
  watch: z.strictObject({ ...binding, revision: z.int().min(-1) }),
  close: z.strictObject(binding),
  open: z.strictObject({
    ...binding,
    address: z.string().min(1).max(16_384),
    line: position.optional(),
  }),
}

export const responseSchemas: { readonly [M in Method]: z.ZodType<Responses[M]> } = {
  create: z.strictObject({ bindingId: z.uuid(), cwd: z.string(), url: z.string() }),
  watch: z.strictObject({
    state: z.enum(['pending', 'ready', 'disconnected', 'expired', 'closed']),
    revision: z.int().nonnegative(),
    reconnect: z.boolean(),
  }),
  close: z.strictObject({ state: z.literal('closed') }),
  open: z.strictObject({ path: z.string(), line: position }),
}

export const METHODS: readonly Method[] = ['create', 'watch', 'close', 'open']

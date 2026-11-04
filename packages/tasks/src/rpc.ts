// The RPC contract between the browser page and the host plugin. It is shared
// by both halves, so it stays free of Node and DOM APIs.
import { z } from 'zod'

/** DSH's shared RPC channel, and the endpoint this plugin owns on it. */
export const RPC_CHANNEL = '/api'
export const RPC_METHOD = 'langify-tasks/list'

/** Failures the host reports; each one has a translated message. */
export const ERROR_CODES = [
  'invalid_request',
  'session_not_found',
  'just_not_found',
  'just_failed',
  'internal_error',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/** List the recipes of the justfile that `just` finds from the session's working folder. */
export interface ListRequest {
  readonly sessionId: string
}

/** One recipe parameter, from `just --dump --dump-format json`. */
export interface Parameter {
  readonly name: string
  /** `star` and `plus` take any number of values; `plus` needs at least one. */
  readonly kind: 'singular' | 'star' | 'plus'
  /** A literal default; `null` when there is none or it is an expression. */
  readonly default: string | null
  /** Whether the recipe can run without this parameter. */
  readonly optional: boolean
  readonly help: string | null
  /** `--long` or `-s` when the parameter is a named option rather than positional. */
  readonly option: string | null
  /** Whether the option is a flag, which takes no value. */
  readonly flag: boolean
}

export interface Recipe {
  readonly name: string
  readonly doc: string | null
  readonly parameters: readonly Parameter[]
}

export interface ListResponse {
  /** The session's working folder, where `just` looks first. */
  readonly cwd: string
  /** The justfile's path; `null` when `just` finds none. */
  readonly justfile: string | null
  /** Public top-level recipes, in `just`'s order. */
  readonly recipes: readonly Recipe[]
}

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.includes('\0'))

export const listRequestSchema: z.ZodType<ListRequest> = z.strictObject({ sessionId: id })

const parameterSchema: z.ZodType<Parameter> = z.strictObject({
  name: z.string(),
  kind: z.enum(['singular', 'star', 'plus']),
  default: z.string().nullable(),
  optional: z.boolean(),
  help: z.string().nullable(),
  option: z.string().nullable(),
  flag: z.boolean(),
})

export const listResponseSchema: z.ZodType<ListResponse> = z.strictObject({
  cwd: z.string(),
  justfile: z.string().nullable(),
  recipes: z.array(
    z.strictObject({
      name: z.string(),
      doc: z.string().nullable(),
      parameters: z.array(parameterSchema),
    }),
  ),
})

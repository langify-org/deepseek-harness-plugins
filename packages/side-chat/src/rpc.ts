// The RPC contract between the browser page and the host plugin. It is shared
// by both halves, so it stays free of Node and DOM APIs.
import { z } from 'zod'

/** DSH's shared RPC channel, and the endpoint this plugin owns on it. */
export const RPC_CHANNEL = '/api'
export const RPC_METHOD = 'langify-side-chat/create'

/** Session projection: `true` for a side chat, from its creation. */
export const PROJECTION_KEY = 'langifySideChat'

/** Failures the host reports; each one has a translated message. */
export const ERROR_CODES = ['invalid_request', 'fork_failed', 'internal_error'] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/** Fork `sessionId` at its latest completed turn into a side chat titled `title`. */
export interface CreateRequest {
  readonly sessionId: string
  readonly title: string
}

/** The side chat, an ordinary session forked from the request's. */
export interface CreateResponse {
  readonly sessionId: string
}

const id = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !value.includes('\0'))

export const createRequestSchema: z.ZodType<CreateRequest> = z.strictObject({
  sessionId: id,
  title: z.string().trim().min(1).max(200),
})
export const createResponseSchema: z.ZodType<CreateResponse> = z.strictObject({ sessionId: id })

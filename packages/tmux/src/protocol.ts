// The messages between a terminal tab and the host plugin, over one WebSocket
// per tab. Terminal output goes host to browser as text frames; input and size
// changes go browser to host as JSON. Shared by both halves: no Node or DOM APIs.
import { z } from 'zod'

/** The WebSocket's path; the query names the session and the starting size. */
export const PATH = '/langify-tmux'

/** Close code the host sends when the terminal's program exited, so the tab does not reconnect. */
export const EXITED = 4000
/** Close code the host sends when it cannot find tmux; the tab says how to get it. */
export const NO_TMUX = 4001

const cols = z.coerce.number().int().min(2).max(1000)
const rows = z.coerce.number().int().min(1).max(500)

/** The query of a new connection: the session and the terminal's starting size. */
export interface OpenQuery {
  readonly session: string
  readonly cols: number
  readonly rows: number
}

export const openQuery: z.ZodType<OpenQuery> = z.object({
  session: z.string().regex(/^[A-Za-z0-9_-]+$/),
  cols: cols,
  rows: rows,
})

/** What the tab sends: keys typed, or its new size. */
export type ClientMessage =
  | { readonly type: 'input'; readonly data: string }
  | { readonly type: 'resize'; readonly cols: number; readonly rows: number }

export const clientMessage: z.ZodType<ClientMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), data: z.string().max(1 << 20) }),
  z.object({ type: z.literal('resize'), cols: cols, rows: rows }),
])

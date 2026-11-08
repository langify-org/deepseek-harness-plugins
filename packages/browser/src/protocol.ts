// The routes and messages between a Browser tab and the host plugin. Each tab
// holds two WebSockets: the VNC stream, whose bytes the plugin relays without
// reading, and a control channel of JSON messages. File downloads and uploads
// use exact routes on DSH's API channel. Shared by both halves: no Node or DOM APIs.
import { z } from 'zod'

/** The kind of the plugin's sidebar tab. */
export const TAB_KIND = 'langify-browser'

/** The VNC stream's WebSocket path; the query is a {@link TabQuery}. */
export const VNC_PATH = '/langify-browser/vnc'
/** The control channel's WebSocket path; the query is a {@link TabQuery}. */
export const CONTROL_PATH = '/langify-browser/control'

/** `GET` with `?id=`: a finished download. An exact route on DSH's API channel. */
export const DOWNLOAD_PATH = '/api/langify-browser/download'
/** `POST` of multipart `file` fields with `?id=` (an {@link UploadQuery}): files for a file chooser. */
export const UPLOAD_PATH = '/api/langify-browser/upload'
/** `POST` with a {@link TabQuery}: the tab was closed, so its window goes too. */
export const CLOSE_PATH = '/api/langify-browser/close'

/** Close code of a control channel whose browser cannot start; an `unavailable` message says why. */
export const UNAVAILABLE = 4001

export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * The smallest and largest screen a tab may ask for, in CSS pixels. No
 * Chromium window is narrower than 500 pixels, so neither is the screen: a
 * narrower tab scrolls sideways instead (see the client's styles).
 */
export const MIN_SIZE: Size = { width: 500, height: 240 }
export const MAX_SIZE: Size = { width: 3840, height: 2160 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(Number.isFinite(value) ? value : min)))
}

/** A size within {@link MIN_SIZE} and {@link MAX_SIZE}, in whole pixels. */
export function clampSize(width: number, height: number): Size {
  return {
    width: clamp(width, MIN_SIZE.width, MAX_SIZE.width),
    height: clamp(height, MIN_SIZE.height, MAX_SIZE.height),
  }
}

/** Which tab a connection or request is for: its conversation, and the tab's own content id. */
export interface TabQuery {
  readonly session: string
  readonly tab: string
}

export const tabQuery: z.ZodType<TabQuery> = z.object({
  session: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  tab: z.string().min(1).max(512),
})

const width = z.number().int().min(MIN_SIZE.width).max(MAX_SIZE.width)
const height = z.number().int().min(MIN_SIZE.height).max(MAX_SIZE.height)
const uploadId = z.string().regex(/^[A-Za-z0-9-]{1,64}$/)

/** What a tab sends on its control channel. */
export type ClientMessage =
  /** Bring this tab's window to the screen, at the tab's size. */
  | { readonly type: 'show'; readonly width: number; readonly height: number }
  /** The tab changed size while its window is on the screen. */
  | { readonly type: 'resize'; readonly width: number; readonly height: number }
  /** Text the user's input method committed, for the focused field of the window's current page. */
  | { readonly type: 'text'; readonly text: string }
  /** The user dismissed a file chooser without choosing. */
  | { readonly type: 'cancelUpload'; readonly id: string }

export const clientMessage: z.ZodType<ClientMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('show'), width, height }),
  z.object({ type: z.literal('resize'), width, height }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(65_536) }),
  z.object({ type: z.literal('cancelUpload'), id: uploadId }),
])

/** Why the browser cannot start: which program is missing, or another failure. */
export type Unavailable = 'xvnc' | 'chromium' | 'failed'

/** What the host sends on a control channel. */
export type ServerMessage =
  /** Whether this tab's window is the one on the screen; only that tab shows the VNC stream. */
  | { readonly type: 'front'; readonly front: boolean }
  /** A download in this tab's window finished; fetch it from {@link DOWNLOAD_PATH}. */
  | {
      readonly type: 'download'
      readonly id: string
      readonly name: string
      readonly size: number
    }
  /** A page in this tab's window opened a file chooser. */
  | { readonly type: 'upload'; readonly id: string; readonly multiple: boolean }
  /** That chooser got its files or was dismissed, here or in another tab. */
  | { readonly type: 'uploadClosed'; readonly id: string }
  /** The browser cannot start; the channel closes with {@link UNAVAILABLE}. */
  | { readonly type: 'unavailable'; readonly reason: Unavailable; readonly detail: string }

export const serverMessage: z.ZodType<ServerMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('front'), front: z.boolean() }),
  z.object({
    type: z.literal('download'),
    id: z.string(),
    name: z.string(),
    size: z.number(),
  }),
  z.object({ type: z.literal('upload'), id: uploadId, multiple: z.boolean() }),
  z.object({ type: z.literal('uploadClosed'), id: uploadId }),
  z.object({
    type: z.literal('unavailable'),
    reason: z.enum(['xvnc', 'chromium', 'failed']),
    detail: z.string(),
  }),
])

/** The query of an upload: the file chooser it answers, whichever tab the user answered in. */
export interface UploadQuery {
  readonly id: string
}

export const uploadQuery: z.ZodType<UploadQuery> = z.object({ id: uploadId })

// The bridge protocol between the host plugin and the VS Code extension: NDJSON
// over a private Unix socket. Both ends ship from this package, so the frames
// are defined once here and validated on receipt. Node only: the page talks to
// the host through ./rpc.ts instead.
import { isAbsolute } from 'node:path'
import type { Readable } from 'node:stream'
import { z } from 'zod'
import {
  HOST_ERROR_CODES,
  OPEN_ERROR_CODES,
  type ErrorCode,
  type FileLocation,
  type OpenErrorCode,
} from './rpc.ts'

/** Largest frame, newline included. */
export const MAX_FRAME_BYTES: number = 64 * 1024

/** Environment variable of the code-server DSH starts, naming the bridge socket every window shares. */
export const SOCKET_ENV = 'DSH_CODE_BRIDGE_SOCKET'

/**
 * Key in the editor window's URL fragment that names its binding. The fragment
 * never reaches a server; the extension reads it back through `asExternalUri`.
 */
export const BINDING_FRAGMENT = 'dsh-binding'

/** First frame from the extension: the binding it was started for and its workspace folder. */
export interface Hello {
  readonly type: 'hello'
  readonly bindingId: string
  readonly cwd: string
}

/** Handshake reply: the binding is now connected, or the connection is refused and closed. */
export type HandshakeReply =
  | { readonly type: 'accepted'; readonly bindingId: string }
  | { readonly type: 'rejected'; readonly code: string; readonly message: string }

/** Open a file in the editor window, before `deadline` (Unix milliseconds). */
export interface OpenRequest extends FileLocation {
  readonly type: 'open'
  readonly requestId: string
  readonly deadline: number
}

/** The session's working folder moved away from the folder this window shows. */
export interface CwdChanged {
  readonly type: 'cwd-changed'
  readonly cwd: string
}

/** A failure the host found while acting for this window; the editor shows it. */
export interface Notice {
  readonly type: 'notice'
  readonly code: ErrorCode
  readonly message: string
}

/** Every frame the host sends after accepting the window. */
export type HostFrame = OpenRequest | CwdChanged | Notice

/** Ask the page for a new window; the extension has already dealt with unsaved changes. */
export interface ReconnectRequest {
  readonly type: 'reconnect'
}

/** The extension's answer to one open request; success reports the line the cursor landed on. */
export type OpenResult =
  | (FileLocation & { readonly type: 'result'; readonly requestId: string; readonly ok: true })
  | {
      readonly type: 'result'
      readonly requestId: string
      readonly ok: false
      readonly error: { readonly code: OpenErrorCode; readonly message: string }
    }

const absolutePath = z
  .string()
  .max(4096)
  .refine((path) => isAbsolute(path) && !path.includes('\0'))
const position = z.int().min(1).max(1_000_000)
const requestId = z.uuid()

export const helloSchema: z.ZodType<Hello> = z.strictObject({
  type: z.literal('hello'),
  bindingId: z.uuid(),
  cwd: absolutePath,
})

export const handshakeReplySchema: z.ZodType<HandshakeReply> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('accepted'), bindingId: z.uuid() }),
  z.strictObject({ type: z.literal('rejected'), code: z.string(), message: z.string() }),
])

export const openRequestSchema: z.ZodType<OpenRequest> = z.strictObject({
  type: z.literal('open'),
  requestId,
  path: absolutePath,
  line: position,
  deadline: z.int().nonnegative(),
})

export const openResultSchema: z.ZodType<OpenResult> = z.discriminatedUnion('ok', [
  z.strictObject({
    type: z.literal('result'),
    requestId,
    ok: z.literal(true),
    path: absolutePath,
    line: position,
  }),
  z.strictObject({
    type: z.literal('result'),
    requestId,
    ok: z.literal(false),
    error: z.strictObject({
      code: z.enum(OPEN_ERROR_CODES),
      message: z.string().max(2048),
    }),
  }),
])

/** Every frame the extension sends after the host accepted it. */
export type EditorFrame = OpenResult | ReconnectRequest

export const hostFrameSchema: z.ZodType<HostFrame> = z.union([
  openRequestSchema,
  z.strictObject({ type: z.literal('cwd-changed'), cwd: absolutePath }),
  z.strictObject({
    type: z.literal('notice'),
    code: z.enum([...OPEN_ERROR_CODES, ...HOST_ERROR_CODES]),
    message: z.string().max(2048),
  }),
])

export const editorFrameSchema: z.ZodType<EditorFrame> = z.union([
  openResultSchema,
  z.strictObject({ type: z.literal('reconnect') }),
])

/** Serialize one frame. */
export function frame(value: Hello | HandshakeReply | HostFrame | EditorFrame): string {
  return `${JSON.stringify(value)}\n`
}

/**
 * Split a stream into JSON frames. Stops at the first frame that is too large
 * or not UTF-8 JSON and reports it once; the caller closes the stream.
 */
export function readFrames(
  stream: Readable,
  onFrame: (value: unknown) => void,
  onInvalid: (error: Error) => void,
): void {
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffered = Buffer.alloc(0)
  let failed = false
  stream.on('data', (chunk: Buffer) => {
    if (failed) return
    try {
      buffered = Buffer.concat([buffered, chunk])
      for (let end = buffered.indexOf(0x0a); end !== -1; end = buffered.indexOf(0x0a)) {
        if (end + 1 > MAX_FRAME_BYTES) throw new Error('frame exceeds 64 KiB')
        const text = decoder.decode(buffered.subarray(0, end))
        buffered = buffered.subarray(end + 1)
        onFrame(JSON.parse(text))
        if (stream.destroyed) return
      }
      if (buffered.length >= MAX_FRAME_BYTES) throw new Error('frame exceeds 64 KiB')
    } catch (error) {
      failed = true
      onInvalid(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

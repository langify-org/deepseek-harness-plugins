// A Chrome DevTools Protocol client on the browser's own WebSocket. Commands go
// to the browser, or to a page attached in flat mode by its session id.
// Results and event parameters reach callers as unknown: each parses the
// fields it uses.
import { WebSocket, type RawData } from 'ws'
import { z } from 'zod'

export interface CdpEvent {
  readonly method: string
  readonly params: unknown
  /** The attached target the event comes from; undefined for the browser itself. */
  readonly sessionId: string | undefined
}

interface Pending {
  readonly method: string
  readonly resolve: (result: unknown) => void
  readonly reject: (error: Error) => void
}

const incoming = z.object({
  id: z.number().optional(),
  method: z.string().optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional(),
  sessionId: z.string().optional(),
})

export class Cdp {
  readonly #socket: WebSocket
  readonly #pending = new Map<number, Pending>()
  readonly #listeners = new Set<(event: CdpEvent) => void>()
  #next = 0
  #ended: Error | undefined
  /** Settles when the connection ends, for whatever reason. */
  readonly closed: Promise<void>

  private constructor(socket: WebSocket) {
    this.#socket = socket
    this.closed = new Promise((resolve) => {
      socket.once('close', () => {
        this.#ended ??= new Error('the browser connection closed')
        for (const pending of this.#pending.values()) pending.reject(this.#ended)
        this.#pending.clear()
        resolve()
      })
    })
    socket.on('error', (error) => {
      this.#ended ??= error
    })
    socket.on('message', (raw: RawData) => this.#receive(raw))
  }

  /** Connect to a browser WebSocket URL, as DevToolsActivePort names it. */
  static connect(url: string, timeoutMs: number): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      // Screenshots arrive as base64 inside one message.
      const socket = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 << 20 })
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error(`the browser did not answer on ${url}`))
      }, timeoutMs)
      socket.once('open', () => {
        clearTimeout(timer)
        resolve(new Cdp(socket))
      })
      socket.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
    })
  }

  /**
   * Send one command and wait for its result.
   * @param sessionId - an attached page's session; omitted for the browser.
   */
  send(method: string, params: object = {}, sessionId?: string): Promise<unknown> {
    if (this.#ended !== undefined) return Promise.reject(this.#ended)
    const id = ++this.#next
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { method, resolve, reject })
      this.#socket.send(
        JSON.stringify({ id, method, params, ...(sessionId === undefined ? {} : { sessionId }) }),
        (error) => {
          if (error === undefined || error === null) return
          this.#pending.delete(id)
          reject(error)
        },
      )
    })
  }

  /** Listen to every event; returns the remover. */
  on(listener: (event: CdpEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  close(): void {
    this.#socket.close()
  }

  #receive(raw: RawData): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(textOf(raw))
    } catch {
      return
    }
    const message = incoming.safeParse(parsed)
    if (!message.success) return
    const { id, method, params, result, error, sessionId } = message.data
    if (id !== undefined) {
      const pending = this.#pending.get(id)
      if (pending === undefined) return
      this.#pending.delete(id)
      if (error !== undefined) pending.reject(new Error(`${pending.method}: ${error.message}`))
      else pending.resolve(result)
      return
    }
    if (method === undefined) return
    const event: CdpEvent = { method, params, sessionId }
    for (const listener of this.#listeners) listener(event)
  }
}

function textOf(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return (raw instanceof ArrayBuffer ? Buffer.from(raw) : raw).toString('utf8')
}

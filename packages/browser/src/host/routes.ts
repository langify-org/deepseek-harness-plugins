// What the Browser tabs reach: per tab, a WebSocket relaying VNC to Xvnc's unix
// socket and a WebSocket of control messages; and exact routes on DSH's API
// channel for downloads, uploads and closing a tab's window. DSH authenticates the exact
// routes itself; its upgrade routes get the same check as its API here.
import { openAsBlob } from 'node:fs'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { createConnection } from 'node:net'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import {
  CLOSE_PATH,
  CONTROL_PATH,
  DOWNLOAD_PATH,
  UNAVAILABLE,
  UPLOAD_PATH,
  VNC_PATH,
  clientMessage,
  tabQuery,
  uploadQuery,
  type ClientMessage,
  type ServerMessage,
  type TabQuery,
} from '../protocol.ts'
import type { Channel, SharedBrowser } from './browser.ts'
import { ProgramMissing, messageOf } from './errors.ts'
import { attachment } from './files.ts'

/** VNC chunks sent and not yet written to the WebSocket before reading from Xvnc pauses. */
const HIGH_WATER = 64
const LOW_WATER = 16
/** The largest upload accepted at once, all files together. */
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024

/** The DSH host services the tabs' routes use. */
export interface RouteServices {
  readonly webServer: {
    registerUpgrade(route: {
      path: string
      handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
    }): () => void
  }
  readonly connection: {
    requestRejection(request: { headers: IncomingHttpHeaders }): 401 | 403 | undefined
    readonly fetch: { register(route: ConnectionFetchRoute): () => Promise<void> }
  }
}

/** The window key of a tab: its conversation and its content id. */
export function keyOf(query: TabQuery): string {
  return `${query.session}:${query.tab}`
}

/** Serve the tabs until `ctx` is disposed. */
export function serveTabs(ctx: Context & RouteServices, browser: SharedBrowser): void {
  const warn = (what: string) => (error: unknown) =>
    ctx.logger.warn(`browser: ${what}: ${messageOf(error)}`)
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 })
  ctx.effect(
    () => () => {
      for (const socket of sockets.clients) socket.terminate()
      sockets.close()
    },
    'browser: sockets',
  )

  /** Relay one VNC stream between the tab and Xvnc, bytes untouched. */
  const relayVnc = (ws: WebSocket): void => {
    const release = browser.connect()
    const early: Buffer[] = []
    let stream: ReturnType<typeof createConnection> | undefined
    ws.on('message', (data: RawData) => {
      const bytes = bytesOf(data)
      if (stream === undefined) early.push(bytes)
      else if (!stream.write(bytes)) ws.pause()
    })
    ws.once('close', () => {
      release()
      stream?.destroy()
    })
    browser.vncSocket().then(
      (path) => {
        if (ws.readyState !== WebSocket.OPEN) return
        const current = createConnection(path)
        stream = current
        for (const bytes of early.splice(0)) current.write(bytes)
        let pending = 0
        current.on('data', (chunk: Buffer) => {
          pending += 1
          if (pending > HIGH_WATER) current.pause()
          ws.send(chunk, () => {
            pending -= 1
            if (pending <= LOW_WATER) current.resume()
          })
        })
        current.on('drain', () => ws.resume())
        current.on('error', (error) => {
          warn('VNC stream')(error)
          ws.close(1011, 'the screen stream failed')
        })
        current.on('close', () => ws.close(1001, 'the screen closed'))
      },
      (error: unknown) => {
        warn('starting the browser for a screen')(error)
        ws.close(1011, 'the browser could not start')
      },
    )
  }

  /** One tab's control channel: it shows its window and types text; it hears about its window. */
  const control = (ws: WebSocket, query: TabQuery): void => {
    const release = browser.connect()
    const key = keyOf(query)
    const channel: Channel = {
      send(message: ServerMessage) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message))
      },
    }
    const remove = browser.addChannel(key, channel)
    ws.once('close', () => {
      remove()
      release()
    })
    const act = async (message: ClientMessage): Promise<void> => {
      switch (message.type) {
        case 'show':
          // Starting the browser and making the window happen here: the tab offers to try again.
          try {
            await browser.show(key, query.session, message)
          } catch (error) {
            warn('showing a window')(error)
            channel.send({
              type: 'unavailable',
              reason: error instanceof ProgramMissing ? error.program : 'failed',
              detail: messageOf(error),
            })
            ws.close(UNAVAILABLE, 'the browser could not show this window')
          }
          return
        case 'resize':
          return browser.resize(key, message)
        case 'text':
          return browser.typeText(key, message.text)
        case 'cancelUpload':
          browser.cancelUpload(message.id)
      }
    }
    // One message at a time, in order: a resize must not overtake the show before it.
    let queue: Promise<void> = Promise.resolve()
    ws.on('message', (raw: RawData) => {
      const message = clientMessage.safeParse(parseJson(bytesOf(raw).toString('utf8')))
      if (!message.success) return
      browser.touch()
      queue = queue.then(() => act(message.data)).catch(warn(message.data.type))
    })
  }

  const upgrade = (path: string, serve: (ws: WebSocket, query: TabQuery) => void): void => {
    ctx.effect(
      () =>
        ctx.webServer.registerUpgrade({
          path,
          handler(req, socket, head) {
            // DSH's upgrade routes do not authenticate: the same check as its API.
            const rejection = ctx.connection.requestRejection({ headers: req.headers })
            if (rejection !== undefined) return refuse(socket, rejection)
            const url = new URL(req.url ?? '/', 'http://localhost')
            const query = tabQuery.safeParse(Object.fromEntries(url.searchParams))
            if (!query.success) return refuse(socket, 400)
            sockets.handleUpgrade(req, socket, head, (ws) => serve(ws, query.data))
          },
        }),
      `browser: ${path}`,
    )
  }
  upgrade(VNC_PATH, (ws) => relayVnc(ws))
  upgrade(CONTROL_PATH, control)

  const routes: ConnectionFetchRoute[] = [
    {
      path: DOWNLOAD_PATH,
      methods: ['GET'],
      requestBody: 'buffered',
      async fetch(request) {
        const download = browser.download(new URL(request.url).searchParams.get('id') ?? '')
        if (download === undefined) return new Response('No such download', { status: 404 })
        const blob = await openAsBlob(download.path).catch(() => undefined)
        if (blob === undefined) return new Response('No such download', { status: 404 })
        return new Response(blob, {
          headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': attachment(download.name),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        })
      },
    },
    {
      path: UPLOAD_PATH,
      methods: ['POST'],
      requestBody: 'streaming',
      async fetch(request) {
        const query = uploadQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!query.success) return new Response('Bad upload', { status: 400 })
        const length = request.headers.get('content-length')
        if (length === null) return new Response('Length required', { status: 411 })
        if (!(Number(length) <= MAX_UPLOAD_BYTES)) {
          return new Response('Too large', { status: 413 })
        }
        const form = await request.formData()
        const files = await Promise.all(
          form
            .getAll('file')
            .filter((value) => typeof value !== 'string')
            .map(async (file) => ({
              name: file.name,
              data: new Uint8Array(await file.arrayBuffer()),
            })),
        )
        try {
          await browser.completeUpload(query.data.id, files)
        } catch (error) {
          return new Response(messageOf(error), { status: 409 })
        }
        return new Response(null, { status: 204 })
      },
    },
    {
      path: CLOSE_PATH,
      methods: ['POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const query = tabQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams))
        if (!query.success) return new Response('Bad tab', { status: 400 })
        await browser.closeWindow(keyOf(query.data))
        return new Response(null, { status: 204 })
      },
    },
  ]
  for (const route of routes) {
    ctx.effect(() => ctx.connection.fetch.register(route), `browser: ${route.path}`)
  }
}

function refuse(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${status === 400 ? 'Bad Request' : 'Unauthorized'}\r\n\r\n`)
}

function bytesOf(raw: RawData): Buffer {
  if (Array.isArray(raw)) return Buffer.concat(raw)
  return raw instanceof ArrayBuffer ? Buffer.from(raw) : raw
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

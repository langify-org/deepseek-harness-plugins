// Forwards an ingress's HTTP requests and WebSocket upgrades to code-server's
// private socket. Each ingress (./ingress/) decides who may pass and the path
// prefix it serves the editor under; code-server never listens on a network
// port itself.
import {
  STATUS_CODES,
  request,
  type ClientRequest,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { Duplex } from 'node:stream'
import type { RunningCodeServer } from './code-server.ts'

export interface RelayOptions {
  /** Path prefix the ingress serves the editor under; removed before code-server sees it. */
  readonly prefix: string
  /** An HTTP status that refuses the request, or undefined to let it through. */
  readonly admit: (req: IncomingMessage) => number | undefined
  /** The running code-server, started if needed. */
  readonly start: () => Promise<RunningCodeServer>
}

/** Credentials belong to the ingress, not to code-server. */
const PRIVATE_HEADERS = new Set(['cookie', 'authorization'])

function forward(req: IncomingMessage, prefix: string, socketPath: string): ClientRequest {
  const path = (req.url ?? '/').slice(prefix.length)
  return request({
    socketPath,
    method: req.method,
    path: path.startsWith('/') ? path : `/${path}`,
    headers: Object.fromEntries(
      Object.entries(req.headers).filter(([name]) => !PRIVATE_HEADERS.has(name)),
    ),
  })
}

/** Handler for HTTP requests below the prefix. */
export function relayRequests({
  prefix,
  admit,
  start,
}: RelayOptions): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const refusal = admit(req)
    if (refusal !== undefined) {
      res.writeHead(refusal).end()
      return
    }
    let server: RunningCodeServer
    try {
      server = await start()
    } catch (error) {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(error instanceof Error ? error.message : 'code-server is unavailable')
      return
    }
    const upstream = forward(req, prefix, server.socketPath)
    upstream.on('response', (response) => {
      res.writeHead(response.statusCode ?? 502, response.statusMessage, response.headers)
      response.pipe(res)
    })
    upstream.on('error', () => {
      if (res.headersSent) res.destroy()
      else res.writeHead(502).end()
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
}

function refuse(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? ''}\r\n\r\n`)
}

/** Handler for WebSocket upgrades below the prefix. */
export function relayUpgrades({
  prefix,
  admit,
  start,
}: RelayOptions): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    const refusal = admit(req)
    if (refusal !== undefined) return refuse(socket, refusal)
    socket.on('error', () => socket.destroy())
    start().then(
      ({ socketPath }) => {
        if (socket.destroyed) return
        const upstream = forward(req, prefix, socketPath)
        upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
          const lines = [`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? ''}`]
          for (let index = 0; index < response.rawHeaders.length; index += 2) {
            lines.push(
              `${response.rawHeaders[index] ?? ''}: ${response.rawHeaders[index + 1] ?? ''}`,
            )
          }
          socket.write(`${lines.join('\r\n')}\r\n\r\n`)
          if (upstreamHead.length > 0) socket.write(upstreamHead)
          if (head.length > 0) upstreamSocket.write(head)
          upstreamSocket.pipe(socket).pipe(upstreamSocket)
          upstreamSocket.on('error', () => socket.destroy())
          upstreamSocket.on('close', () => socket.destroy())
          socket.on('close', () => upstreamSocket.destroy())
        })
        upstream.on('response', (response) => {
          response.resume()
          refuse(socket, response.statusCode ?? 502)
        })
        upstream.on('error', () => socket.destroy())
        socket.on('close', () => upstream.destroy())
        upstream.end()
      },
      () => refuse(socket, 502),
    )
  }
}

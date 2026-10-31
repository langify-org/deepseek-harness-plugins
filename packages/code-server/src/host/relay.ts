// Serves code-server under DSH's own origin: every HTTP request and WebSocket
// upgrade passes DSH's browser authentication before reaching code-server's
// private socket, so code-server never listens on a network port.
import {
  STATUS_CODES,
  request,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { Duplex } from 'node:stream'
import type {
  ConnectionRequestRejection,
  ConnectionTrustRequest,
} from '@deepseek-ai/dsh-client-connection'
import type { RunningCodeServer } from './code-server.ts'

/** Path prefix code-server is served under, relative to the DSH page. */
export const RELAY_PREFIX = '/code-server'

/** DSH's Host/Origin and browser authentication check. */
export type Admission = (request: ConnectionTrustRequest) => ConnectionRequestRejection

/** DSH's credentials are not code-server's business. */
const PRIVATE_HEADERS = new Set(['cookie', 'authorization'])

function upstreamHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !PRIVATE_HEADERS.has(name)))
}

function upstreamPath(url = '/'): string {
  const path = url.slice(RELAY_PREFIX.length)
  return path.startsWith('/') ? path : `/${path}`
}

/** Handler for HTTP requests below {@link RELAY_PREFIX}. */
export function relayRequests(
  admission: Admission,
  start: () => Promise<RunningCodeServer>,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const rejection = admission({ headers: req.headers })
    if (rejection !== undefined) {
      res.writeHead(rejection).end()
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
    const upstream = request(
      {
        socketPath: server.socketPath,
        method: req.method,
        path: upstreamPath(req.url),
        headers: upstreamHeaders(req.headers),
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.statusMessage, response.headers)
        response.pipe(res)
      },
    )
    upstream.on('error', () => {
      if (res.headersSent) res.destroy()
      else res.writeHead(502).end()
    })
    res.on('close', () => upstream.destroy())
    req.pipe(upstream)
  }
}

/** Handler for code-server's WebSocket upgrades, which arrive on one exact path. */
export function relayUpgrades(
  admission: Admission,
  socketPath: string,
): (req: IncomingMessage, socket: Duplex, head: Buffer) => void {
  return (req, socket, head) => {
    const rejection = admission({ headers: req.headers })
    if (rejection !== undefined) {
      socket.end(`HTTP/1.1 ${rejection} ${STATUS_CODES[rejection] ?? ''}\r\n\r\n`)
      return
    }
    const upstream = request({
      socketPath,
      method: req.method,
      path: upstreamPath(req.url),
      headers: upstreamHeaders(req.headers),
    })
    upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? ''}`]
      for (let index = 0; index < response.rawHeaders.length; index += 2) {
        lines.push(`${response.rawHeaders[index] ?? ''}: ${response.rawHeaders[index + 1] ?? ''}`)
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
      socket.end(`HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage ?? ''}\r\n\r\n`)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    upstream.end()
  }
}

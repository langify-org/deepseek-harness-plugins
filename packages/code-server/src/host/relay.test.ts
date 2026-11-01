import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import {
  createServer,
  request,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
  type Server,
} from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { RELAY_PREFIX, relayRequests, relayUpgrades, type Admission } from './relay.ts'

/** Requests that reached the fake code-server. */
const reached: { url: string | undefined; headers: IncomingHttpHeaders }[] = []
let dir: string
let codeServer: Server
let dsh: Server
let port: number

// Stands in for DSH's browser authentication.
const admission: Admission = ({ headers }) =>
  !(headers instanceof Headers) && headers.cookie === 'dsh=ok' ? undefined : 401

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'relay-'))
  const socketPath = join(dir, 'code-server.sock')
  codeServer = createServer((req, res) => {
    reached.push({ url: req.url, headers: req.headers })
    if (req.url?.startsWith('/?') === true) {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': 36 })
      res.end('<html><head lang="en"></head></html>')
      return
    }
    res.end('code-server')
  })
  codeServer.on('upgrade', (req, socket: Socket) => {
    reached.push({ url: req.url, headers: req.headers })
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n',
    )
    socket.pipe(socket)
  })
  codeServer.listen(socketPath)
  await once(codeServer, 'listening')
  const relay = relayRequests(admission, async () => ({ socketPath, commit: 'commit' }))
  dsh = createServer((req, res) => void relay(req, res))
  dsh.on('upgrade', relayUpgrades(admission, socketPath))
  dsh.listen(0, '127.0.0.1')
  await once(dsh, 'listening')
  port = (dsh.address() as AddressInfo).port
})

beforeEach(() => {
  reached.length = 0
})

afterAll(async () => {
  dsh.closeAllConnections()
  codeServer.closeAllConnections()
  dsh.close()
  codeServer.close()
  await rm(dir, { recursive: true, force: true })
})

function get(
  path: string,
  headers: OutgoingHttpHeaders,
): Promise<{ status: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    request({ port, path, headers }, async (response) => {
      let body = ''
      for await (const chunk of response) body += String(chunk)
      resolve({ status: response.statusCode, body })
    })
      .on('error', reject)
      .end()
  })
}

/** Resolves with the upgraded socket, or with the refusal's status. */
function upgrade(headers: OutgoingHttpHeaders): Promise<Socket | number | undefined> {
  return new Promise((resolve, reject) => {
    request({
      port,
      path: `${RELAY_PREFIX}/stable-commit?reconnectionToken=1`,
      headers: { ...headers, connection: 'Upgrade', upgrade: 'websocket' },
    })
      .on('upgrade', (_response, socket) => resolve(socket))
      .on('response', (response) => resolve(response.statusCode))
      .on('error', reject)
      .end()
  })
}

it('refuses requests DSH does not authenticate before they reach code-server', async () => {
  expect((await get(`${RELAY_PREFIX}/?folder=/tmp`, {})).status).toBe(401)
  expect(await upgrade({})).toBe(401)
  expect(reached).toEqual([])
})

it("forwards authenticated requests below the prefix without DSH's credentials", async () => {
  const response = await get(`${RELAY_PREFIX}/static/app.js?v=1`, {
    cookie: 'dsh=ok',
    authorization: 'Bearer x',
  })
  expect(response).toEqual({ status: 200, body: 'code-server' })
  expect(reached).toHaveLength(1)
  expect(reached[0]?.url).toBe('/static/app.js?v=1')
  expect(reached[0]?.headers).not.toHaveProperty('cookie')
  expect(reached[0]?.headers).not.toHaveProperty('authorization')
})

it('relays authenticated WebSocket upgrades in both directions', async () => {
  const socket = await upgrade({ cookie: 'dsh=ok' })
  if (typeof socket !== 'object') throw new Error(`upgrade refused: ${String(socket)}`)
  socket.write('ping')
  const [echo] = await once(socket, 'data')
  expect(String(echo)).toBe('ping')
  expect(reached[0]?.headers).not.toHaveProperty('cookie')
  socket.destroy()
})

it("puts Desktop's WebSocket script ahead of code-server's page and serves it", async () => {
  const page = await get(`${RELAY_PREFIX}/?folder=/tmp`, {
    cookie: 'dsh=ok',
    'accept-encoding': 'gzip',
  })
  expect(page.body).toBe(
    '<html><head lang="en"><script src="./_dsh/desktop-websocket.js"></script></head></html>',
  )
  expect(reached[0]?.headers['accept-encoding']).toBe('identity')
  const script = await get(`${RELAY_PREFIX}/_dsh/desktop-websocket.js`, { cookie: 'dsh=ok' })
  expect(script.body).toContain('streamBaseUrl')
  expect(reached).toHaveLength(1)
})

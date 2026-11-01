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
import { relayRequests, relayUpgrades, type RelayOptions } from './relay.ts'

const RELAY_PREFIX = '/code-server'

/** Requests that reached the fake code-server. */
const reached: { url: string | undefined; headers: IncomingHttpHeaders }[] = []
let dir: string
let codeServer: Server
let dsh: Server
let port: number

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'relay-'))
  const socketPath = join(dir, 'code-server.sock')
  codeServer = createServer((req, res) => {
    reached.push({ url: req.url, headers: req.headers })
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
  const relay: RelayOptions = {
    prefix: RELAY_PREFIX,
    // Stands in for an ingress's authentication.
    admit: (req) => (req.headers.cookie === 'dsh=ok' ? undefined : 401),
    start: async () => ({ socketPath, commit: 'commit' }),
  }
  const handle = relayRequests(relay)
  dsh = createServer((req, res) => void handle(req, res))
  dsh.on('upgrade', relayUpgrades(relay))
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

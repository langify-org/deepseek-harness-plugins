import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer, request, type OutgoingHttpHeaders, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { DesktopIngress } from './desktop.ts'

let dir: string
let codeServer: Server
let ingress: DesktopIngress
let base: URL

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'desktop-'))
  const socketPath = join(dir, 'code-server.sock')
  codeServer = createServer((req, res) => res.end(`code-server ${req.url ?? ''}`))
  codeServer.listen(socketPath)
  await once(codeServer, 'listening')
  ingress = new DesktopIngress(0, async () => ({ socketPath, commit: 'commit' }))
  base = new URL(await ingress.base())
})

afterAll(async () => {
  await ingress.dispose()
  codeServer.close()
  await rm(dir, { recursive: true, force: true })
})

function get(
  path: string,
  headers: OutgoingHttpHeaders = {},
): Promise<[number | undefined, string]> {
  return new Promise((resolve, reject) => {
    request({ host: base.hostname, port: base.port, path, headers }, async (response) => {
      let body = ''
      for await (const chunk of response) body += String(chunk)
      resolve([response.statusCode, body])
    })
      .on('error', reject)
      .end()
  })
}

it('serves the editor on 127.0.0.1 below a secret path', async () => {
  expect(base.hostname).toBe('127.0.0.1')
  expect(base.pathname).toMatch(/^\/[\w-]{43}\/$/)
  expect(await get(`${base.pathname}static/app.js`)).toEqual([200, 'code-server /static/app.js'])
})

it('refuses another path and a page that reached the port under another host name', async () => {
  expect(await get('/static/app.js')).toEqual([404, ''])
  expect(await get(`/${'x'.repeat(43)}/`)).toEqual([404, ''])
  expect(await get(base.pathname, { host: `attacker.example:${base.port}` })).toEqual([403, ''])
})

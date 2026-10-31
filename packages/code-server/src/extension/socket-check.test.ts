import { once } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { checkSocket } from './socket-check.ts'

let root: string
let privateDir: string
let socketPath: string
let server: Server

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'socket-check-'))
  privateDir = join(root, 'private')
  await mkdir(privateDir, { mode: 0o700 })
  socketPath = join(privateDir, 'bridge.sock')
  server = createServer().listen(socketPath)
  await once(server, 'listening')
  await chmod(socketPath, 0o600)
})

afterEach(async () => {
  server.close()
  await rm(root, { recursive: true, force: true })
})

it('accepts a socket only this user can reach', () => {
  expect(() => checkSocket(socketPath)).not.toThrow()
})

it('refuses a socket in a directory other users can enter', async () => {
  await chmod(privateDir, 0o750)
  expect(() => checkSocket(socketPath)).toThrow('directory')
})

it('refuses a socket reached through a symlinked directory', async () => {
  await symlink(privateDir, join(root, 'link'))
  expect(() => checkSocket(join(root, 'link', 'bridge.sock'))).toThrow('directory')
})

it('refuses a file that is not a socket', async () => {
  await writeFile(join(privateDir, 'file'), '', { mode: 0o600 })
  expect(() => checkSocket(join(privateDir, 'file'))).toThrow('socket')
})

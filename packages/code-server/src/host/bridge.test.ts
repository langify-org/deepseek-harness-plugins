import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { frame, openRequestSchema, readFrames } from '../protocol.ts'
import { Bridge, CONNECT_TIMEOUT_MS, LEASE_MS, OPEN_TIMEOUT_MS } from './bridge.ts'

const CWD = '/project'
let dir: string
let bridge: Bridge

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  dir = await mkdtemp(join(tmpdir(), 'bridge-'))
  bridge = await Bridge.listen(join(dir, 'bridge.sock'))
})

afterEach(async () => {
  await bridge.dispose()
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

/** Connect as an editor window's extension and say hello. */
async function editorWindow(
  bindingId: string,
  cwd = CWD,
): Promise<{ socket: Socket; reply: unknown; next: () => Promise<unknown> }> {
  const socket = createConnection(join(dir, 'bridge.sock'))
  const received: unknown[] = []
  const waiting: ((value: unknown) => void)[] = []
  readFrames(
    socket,
    (value) => (waiting.shift() ?? ((queued: unknown) => received.push(queued)))(value),
    () => {},
  )
  const next = (): Promise<unknown> =>
    received.length > 0
      ? Promise.resolve(received.shift())
      : new Promise((resolve) => waiting.push(resolve))
  await once(socket, 'connect')
  socket.write(frame({ type: 'hello', bindingId, cwd }))
  return { socket, reply: await next(), next }
}

it('expires a binding no window claims', () => {
  const { bindingId } = bridge.create('session', 'page', CWD)
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1)
  expect(bridge.ping('session', bindingId)).toBe('pending')
  vi.advanceTimersByTime(1)
  expect(bridge.ping('session', bindingId)).toBe('expired')
})

it('keeps a connected window while the page pings, and drops it when pings stop', async () => {
  const { bindingId } = bridge.create('session', 'page', CWD)
  const editor = await editorWindow(bindingId)
  expect(editor.reply).toEqual({ type: 'accepted', bindingId })
  vi.advanceTimersByTime(LEASE_MS - 1)
  expect(bridge.ping('session', bindingId)).toBe('ready')
  vi.advanceTimersByTime(LEASE_MS - 1)
  expect(bridge.ping('session', bindingId)).toBe('ready')
  const closed = once(editor.socket, 'close')
  vi.advanceTimersByTime(LEASE_MS)
  expect(bridge.ping('session', bindingId)).toBe('expired')
  await closed
})

it('lets one window of the same folder claim a binding, once', async () => {
  const { bindingId } = bridge.create('session', 'page', CWD)
  const refused = await editorWindow(bindingId, '/elsewhere')
  expect(refused.reply).toMatchObject({ code: 'cwd_mismatch' })
  // The refused connection cannot try again.
  refused.socket.write(frame({ type: 'hello', bindingId, cwd: CWD }))
  await once(refused.socket, 'close')
  expect(bridge.ping('session', bindingId)).toBe('pending')
  expect((await editorWindow(bindingId)).reply).toEqual({ type: 'accepted', bindingId })
  expect((await editorWindow(bindingId)).reply).toMatchObject({ code: 'binding_unavailable' })
})

it('reports an unknown outcome when the window does not answer or disconnects', async () => {
  const { bindingId } = bridge.create('session', 'page', CWD)
  const editor = await editorWindow(bindingId)

  const opened = bridge.open('session', bindingId, { path: '/project/a.ts', line: 3 })
  const { requestId } = openRequestSchema.parse(await editor.next())
  editor.socket.write(
    frame({ type: 'result', requestId, ok: true, path: '/project/a.ts', line: 3 }),
  )
  await expect(opened).resolves.toEqual({ path: '/project/a.ts', line: 3 })

  const unanswered = bridge.open('session', bindingId, { path: '/project/a.ts', line: 1 })
  await editor.next()
  vi.advanceTimersByTime(OPEN_TIMEOUT_MS)
  await expect(unanswered).rejects.toMatchObject({ code: 'outcome_unknown' })

  const cut = bridge.open('session', bindingId, { path: '/project/a.ts', line: 1 })
  await editor.next()
  editor.socket.destroy()
  await expect(cut).rejects.toMatchObject({ code: 'outcome_unknown' })
  expect(bridge.ping('session', bindingId)).toBe('disconnected')
})

import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { frame, openRequestSchema, readFrames } from '../bridge-protocol.ts'
import { Bridge, CONNECT_TIMEOUT_MS, LEASE_MS, OPEN_TIMEOUT_MS, WATCH_MS } from './bridge.ts'

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

/** The binding's state now, as a page's first watch reads it. */
async function state(bindingId: string): Promise<string> {
  return (await bridge.watch('session', bindingId, -1, new AbortController().signal)).state
}

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

it('expires a binding no window attaches to', async () => {
  const bindingId = bridge.create('session', 'page', CWD)
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS - 1)
  expect(await state(bindingId)).toBe('pending')
  vi.advanceTimersByTime(1)
  expect(await state(bindingId)).toBe('expired')
})

it('keeps a connected window while the page watches, and drops it when watches stop', async () => {
  const bindingId = bridge.create('session', 'page', CWD)
  const editor = await editorWindow(bindingId)
  expect(editor.reply).toEqual({ type: 'accepted', bindingId })
  vi.advanceTimersByTime(LEASE_MS - 1)
  expect(await state(bindingId)).toBe('ready')
  vi.advanceTimersByTime(LEASE_MS - 1)
  expect(await state(bindingId)).toBe('ready')
  const closed = once(editor.socket, 'close')
  vi.advanceTimersByTime(LEASE_MS)
  expect(await state(bindingId)).toBe('expired')
  await closed
})

it('attaches a window of the same folder, and lets a reloaded window take over', async () => {
  const bindingId = bridge.create('session', 'page', CWD)
  const refused = await editorWindow(bindingId, '/elsewhere')
  expect(refused.reply).toMatchObject({ code: 'cwd_mismatch' })
  // The refused connection cannot try again.
  refused.socket.write(frame({ type: 'hello', bindingId, cwd: CWD }))
  await once(refused.socket, 'close')
  expect(await state(bindingId)).toBe('pending')

  const first = await editorWindow(bindingId)
  expect(first.reply).toEqual({ type: 'accepted', bindingId })
  const replaced = once(first.socket, 'close')
  expect((await editorWindow(bindingId)).reply).toEqual({ type: 'accepted', bindingId })
  await replaced
  expect(await state(bindingId)).toBe('ready')

  bridge.close('session', bindingId)
  expect((await editorWindow(bindingId)).reply).toMatchObject({ code: 'binding_unavailable' })
})

it('reports an unknown outcome when the window does not answer or goes away', async () => {
  const bindingId = bridge.create('session', 'page', CWD)
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
  // Waits for the window as for a new binding: it may be reloading.
  expect(await state(bindingId)).toBe('pending')
  vi.advanceTimersByTime(CONNECT_TIMEOUT_MS)
  expect(await state(bindingId)).toBe('expired')
})

it('answers a watch as soon as the binding changes, and otherwise after a while', async () => {
  const bindingId = bridge.create('session', 'page', CWD)
  const signal = new AbortController().signal
  const first = await bridge.watch('session', bindingId, -1, signal)

  const claimed = bridge.watch('session', bindingId, first.revision, signal)
  const editor = await editorWindow(bindingId)
  const ready = await claimed
  expect(ready).toMatchObject({ state: 'ready', reconnect: false })

  const quiet = bridge.watch('session', bindingId, ready.revision, signal)
  vi.advanceTimersByTime(WATCH_MS)
  expect(await quiet).toEqual(ready)

  const asked = bridge.watch('session', bindingId, ready.revision, signal)
  editor.socket.write(frame({ type: 'reconnect' }))
  expect(await asked).toMatchObject({ state: 'ready', reconnect: true })
})

it("tells the editor about a new working folder once, and about a timeout it didn't see", async () => {
  const bindingId = bridge.create('session', 'page', CWD)
  const editor = await editorWindow(bindingId)
  bridge.announceCwd('session', bindingId, CWD)
  bridge.announceCwd('session', bindingId, '/other')
  bridge.announceCwd('session', bindingId, '/other')
  expect(await editor.next()).toEqual({ type: 'cwd-changed', cwd: '/other' })

  const unanswered = bridge.open('session', bindingId, { path: '/project/a.ts', line: 1 })
  expect(await editor.next()).toMatchObject({ type: 'open' })
  vi.advanceTimersByTime(OPEN_TIMEOUT_MS)
  await expect(unanswered).rejects.toMatchObject({ code: 'outcome_unknown' })
  expect(await editor.next()).toMatchObject({ type: 'notice', code: 'outcome_unknown' })
})

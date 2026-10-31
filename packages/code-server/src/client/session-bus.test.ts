import { expect, it } from 'vitest'
import { SessionBus } from './session-bus.ts'

const file = (address: string): { address: string; line: undefined } => ({
  address,
  line: undefined,
})

it('queues each navigation once and hands files out in order', () => {
  const bus = new SessionBus()
  bus.enqueue('tab:1', file('a'))
  bus.enqueue('tab:1', file('a'))
  bus.enqueue('tab:2', file('b'))
  expect([bus.take(), bus.take(), bus.take()]).toEqual([file('a'), file('b'), undefined])
})

it('refuses files when too many wait or the connection has ended', () => {
  const bus = new SessionBus()
  for (let index = 0; index <= 16; index++) bus.enqueue(`tab:${index}`, file(`f${index}`))
  expect(bus.getSnapshot()).toMatchObject({ notice: { key: 'queue.full' } })
  expect(bus.getSnapshot().queue).toHaveLength(16)
  bus.phase('expired')
  bus.enqueue('tab:late', file('late'))
  expect(bus.getSnapshot()).toMatchObject({ queue: [], notice: { key: 'queue.ended' } })
})

it('drops files that waited too long', () => {
  let now = 0
  const bus = new SessionBus(() => now)
  bus.enqueue('tab:old', file('old'))
  now = 60_001
  bus.enqueue('tab:new', file('new'))
  expect(bus.take()).toEqual(file('new'))
  expect(bus.getSnapshot().notice).toEqual({ key: 'queue.expired' })
})

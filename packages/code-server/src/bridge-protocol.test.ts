import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { MAX_FRAME_BYTES, readFrames } from './bridge-protocol.ts'

function collect(): { stream: PassThrough; frames: unknown[]; errors: Error[] } {
  const stream = new PassThrough()
  const frames: unknown[] = []
  const errors: Error[] = []
  readFrames(
    stream,
    (value) => frames.push(value),
    (error) => errors.push(error),
  )
  return { stream, frames, errors }
}

it('reassembles frames split across chunks and several in one chunk', () => {
  const { stream, frames, errors } = collect()
  stream.write('{"a":1}\n{"b"')
  stream.write(':2}\n{"c":3}\n')
  expect(frames).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }])
  expect(errors).toEqual([])
})

it('reports an oversized frame once and reads nothing after it', () => {
  const { stream, frames, errors } = collect()
  stream.write(`"${'x'.repeat(MAX_FRAME_BYTES)}`)
  stream.write('"\n{"after":true}\n')
  expect(frames).toEqual([])
  expect(errors).toHaveLength(1)
})

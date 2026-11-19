import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { shownHunches } from './index.ts'

const hunch = (seq: number, files?: string[], text = ''): unknown => ({
  type: 'user/message',
  seq,
  surfaceOp: 'append',
  data: {
    role: 'user',
    source: { kind: 'langify-memory-hunch', ...(files === undefined ? {} : { files }) },
    content: [{ type: 'text', text }],
  },
})

const compacted = (seq: number, sourceEventSeqs: number[]): unknown => ({
  type: 'user/message',
  seq,
  surfaceOp: { op: 'replace', startSeq: sourceEventSeqs[0], endSeq: sourceEventSeqs.at(-1) },
  sourceEventSeqs,
  data: {
    role: 'user',
    source: { kind: 'compact-checkpoint' },
    content: [{ type: 'text', text: 'summary' }],
  },
})

const shown = (events: unknown[]): string[] =>
  [...shownHunches(events as SessionEvent[])].toSorted()

describe('shownHunches', () => {
  it('keeps the hunches a conversation was given, by file or by name in the text', () => {
    expect(
      shown([
        hunch(3, undefined, 'Memory brought up\n=== hunches/think-aloud.md ==='),
        hunch(5, ['hunches/bank-transfer.md']),
      ]),
    ).toEqual(['hunches/bank-transfer.md', 'hunches/think-aloud.md'])
  })

  it('lets go of a hunch that compaction hid, so that it can come up again', () => {
    expect(
      shown([
        hunch(3, ['hunches/think-aloud.md']),
        hunch(5, ['hunches/bank-transfer.md']),
        compacted(10, [1, 2, 3, 4]),
      ]),
    ).toEqual(['hunches/bank-transfer.md'])
  })

  it('keeps a hunch given again after compaction', () => {
    expect(
      shown([
        hunch(3, ['hunches/think-aloud.md']),
        compacted(10, [1, 2, 3]),
        hunch(12, ['hunches/think-aloud.md']),
      ]),
    ).toEqual(['hunches/think-aloud.md'])
  })
})

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { recallText, todayText } from '../delivery.ts'
import { recalledAfter, type Recalled } from './index.ts'

const cat = { file: 'projects/cat.md', line: 12, text: '- postbox drops what is over 200 a day.' }
const trip = {
  file: 'projects/trip.md',
  line: 4,
  text: '- Tell the travel agent of big luggage by 11/19.',
}

const given = (seq: number, text: string): unknown => ({
  type: 'user/message',
  seq,
  surfaceOp: 'append',
  data: {
    role: 'user',
    source: { kind: 'langify-memory-recall', form: 'notice', summary: 'Recalled' },
    content: [{ type: 'text', text }],
  },
})

const said = (seq: number, text: string): unknown => ({
  type: 'user/message',
  seq,
  surfaceOp: 'append',
  data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] },
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

const fold = (events: unknown[]): Recalled =>
  (events as SessionEvent[]).reduce(recalledAfter, { lines: {}, days: {} })

describe('recalledAfter', () => {
  it('keeps the lines a conversation was shown and the day it was shown those that name it', () => {
    const state = fold([
      said(1, 'how many mails can postbox send?'),
      given(2, todayText('2026-11-19', [trip])),
      given(3, recallText([cat])),
    ])
    expect(Object.values(state.lines).toSorted((a, b) => a - b)).toEqual([2, 3])
    expect(state.days).toEqual({ '2026-11-19': 2 })
  })

  it('knows a line again by its file and text, not by its number', () => {
    const before = fold([given(2, recallText([cat]))])
    const moved = fold([given(2, recallText([{ ...cat, line: 40 }]))])
    expect(moved.lines).toEqual(before.lines)
  })

  it('leaves the state as it was for events that show nothing', () => {
    const state = fold([given(2, recallText([cat]))])
    expect(recalledAfter(state, said(3, 'thanks') as SessionEvent)).toBe(state)
    expect(recalledAfter(state, compacted(4, [3]) as SessionEvent)).toBe(state)
  })

  it('lets go of what compaction hid, so that it can be shown again', () => {
    const state = fold([
      given(2, todayText('2026-11-19', [trip])),
      given(3, recallText([cat])),
      compacted(10, [1, 2]),
    ])
    expect(Object.values(state.lines)).toEqual([3])
    expect(state.days).toEqual({})
  })
})

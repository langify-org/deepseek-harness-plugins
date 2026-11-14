import { describe, expect, it } from 'vitest'
import { indexHead, parseCommits } from './delivery.ts'

describe('parseCommits', () => {
  it('separates each message from its source trailers', () => {
    const output =
      'aaa\u001fAdd a note\n\nMemory-Source: s1\nMemory-Source: s2\n\u001e\n' +
      'bbb\u001fTidy up\n\nMemory-Source: is not a trailer here\n\nDone.\n\u001e\n'
    expect(parseCommits(output)).toEqual([
      { hash: 'aaa', message: 'Add a note', sources: ['s1', 's2'] },
      {
        hash: 'bbb',
        message: 'Tidy up\n\nMemory-Source: is not a trailer here\n\nDone.',
        sources: [],
      },
    ])
    expect(parseCommits('')).toEqual([])
  })
})

describe('indexHead', () => {
  it('keeps the whole index when it fits', () => {
    expect(indexHead('# Memory\n- a\n', { lines: 2, bytes: 100 })).toBe('# Memory\n- a')
  })

  it('stops at the line limit or the byte limit, whichever comes first, and says so', () => {
    expect(indexHead('1\n2\n3\n4', { lines: 2, bytes: 100 })).toBe(
      '1\n2\n\n(2 more lines in MEMORY.md)',
    )
    // Each 記 is three bytes: the second line would pass 8 bytes.
    expect(indexHead('記憶\n記憶\n記憶', { lines: 10, bytes: 8 })).toBe(
      '記憶\n\n(2 more lines in MEMORY.md)',
    )
  })
})

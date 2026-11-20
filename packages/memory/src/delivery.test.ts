import { describe, expect, it } from 'vitest'
import {
  baselineText,
  indexHead,
  parseCommits,
  recallText,
  shownIn,
  todayText,
} from './delivery.ts'

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

describe('baselineText', () => {
  it('names the files of episodes that what is known does not hold yet', () => {
    const text = baselineText('/memory', '0123456789abcdef', '# Memory', [
      { file: 'episodes/2026-11-15/1234abcd.md', title: 'Cat camera' },
    ])
    expect(text).toContain('<memory version="0123456">')
    expect(text).toContain('- episodes/2026-11-15/1234abcd.md: Cat camera')
  })

  it('says nothing of episodes when all are part of what is known', () => {
    expect(baselineText('/memory', '0123456789abcdef', '# Memory', [])).not.toContain('episodes')
  })
})

describe('what is put beside what was said', () => {
  const line = {
    file: 'projects/cat.md',
    line: 12,
    text: '- postbox drops what is over 200 a day.',
  }

  it('shows each recalled line with where it is', () => {
    expect(recallText([line])).toContain(
      '- projects/cat.md:12: - postbox drops what is over 200 a day.',
    )
  })

  it('shows the lines that name today under its date', () => {
    const text = todayText('2026-11-16', [line])
    expect(text).toContain('<memory-today date="2026-11-16">')
    expect(text).toContain('- projects/cat.md:12:')
    // A promise for today may have been kept by a conversation of today, which these lines are not from.
    expect(text).toContain('What conversations noted today is not among them')
  })

  it('reads back from the message what it showed, as it showed it', () => {
    const long = { file: 'MEMORY.md', line: 3, text: `- ${'記'.repeat(450)}` }
    expect(shownIn(recallText([line, long]))).toEqual({
      lines: [
        { file: 'projects/cat.md', text: '- postbox drops what is over 200 a day.' },
        { file: 'MEMORY.md', text: `- ${'記'.repeat(398)}…` },
      ],
    })
    expect(shownIn(todayText('2026-11-16', [line]))).toEqual({
      date: '2026-11-16',
      lines: [{ file: 'projects/cat.md', text: '- postbox drops what is over 200 a day.' }],
    })
  })

  it('reads the lines that name today as messages before the wording changed showed them', () => {
    const before = [
      '<memory-today date="2026-11-19">',
      'Lines of your memory that name today:',
      '- projects/phuket-trip.md:12: - 11/19 までに HIS に大きな荷物を連絡する',
      '</memory-today>',
    ].join('\n')
    expect(shownIn(before)).toEqual({
      date: '2026-11-19',
      lines: [
        { file: 'projects/phuket-trip.md', text: '- 11/19 までに HIS に大きな荷物を連絡する' },
      ],
    })
  })
})

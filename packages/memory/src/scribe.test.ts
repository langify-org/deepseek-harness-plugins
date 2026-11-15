import { describe, expect, it } from 'vitest'
import { compareRequest, episodeEntries, episodeEntry, episodeHead } from './scribe.ts'

const source = {
  sessionId: 'session-1234',
  title: 'Cat camera',
  cwd: '/work/cat',
  from: 4,
  to: 18,
}

describe('a file of episodes', () => {
  it('gives back the entries that were appended to it', () => {
    const file =
      episodeHead(source) +
      episodeEntry(
        source,
        '14:21',
        'Recordings stay at home.\n\n- Why: the room is in the picture.',
      ) +
      episodeEntry({ ...source, from: 19, to: 27 }, '14:40', 'Kept for 14 days, not 7.')
    expect(episodeEntries(file)).toEqual([
      {
        heading: '14:21 (events 4 to 18)',
        entry: 'Recordings stay at home.\n\n- Why: the room is in the picture.',
      },
      { heading: '14:40 (events 19 to 27)', entry: 'Kept for 14 days, not 7.' },
    ])
  })

  it('keeps a reply that has headings of its own as one entry', () => {
    const file =
      episodeHead(source) +
      episodeEntry(
        source,
        '14:21',
        '## 14:20 Cat camera\n\nRecordings stay at home.\n\n# Why\n\nThe room.',
      )
    expect(episodeEntries(file)).toEqual([
      {
        heading: '14:21 (events 4 to 18)',
        entry: '#### 14:20 Cat camera\n\nRecordings stay at home.\n\n### Why\n\nThe room.',
      },
    ])
  })

  it('has no entries before any was appended', () => {
    expect(episodeEntries(episodeHead(source))).toEqual([])
  })
})

describe('compareRequest', () => {
  it('puts each entry beside its lines, numbered, with where they are', () => {
    const text = compareRequest([
      {
        file: 'episodes/2026-11-15/1234.md',
        heading: '14:21 (events 4 to 18)',
        entry: 'A deploy that fails starts over.',
        lines: [{ file: 'projects/blog.md', line: 9, text: '- kiln resumes with --resume.' }],
      },
      {
        file: 'episodes/2026-11-15/5678.md',
        heading: '15:00 (events 2 to 6)',
        entry: 'New.',
        lines: [],
      },
    ])
    expect(text).toContain('=== episodes/2026-11-15/1234.md, 14:21 (events 4 to 18) ===')
    expect(text).toContain('1. projects/blog.md:9: - kiln resumes with --resume.')
    expect(text).toContain('(No line of what is known shares words with it.)')
  })
})

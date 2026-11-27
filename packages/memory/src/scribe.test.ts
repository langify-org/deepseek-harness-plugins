import { describe, expect, it } from 'vitest'
import {
  compareRequest,
  consolidateRequest,
  episodeEntries,
  episodeEntry,
  episodeFile,
  episodeHead,
  isEpisodeOf,
  newEntries,
} from './scribe.ts'

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

  it('tells the entries appended since memory was last brought up to date', () => {
    const before = episodeHead(source) + episodeEntry(source, '14:21', 'Recordings stay at home.')
    const now = before + episodeEntry({ ...source, from: 19, to: 27 }, '14:40', 'Kept for 14 days.')
    expect(newEntries(before, now)).toEqual([
      { heading: '14:40 (events 19 to 27)', entry: 'Kept for 14 days.' },
    ])
    // A file that was not there then is new from its first entry.
    expect(newEntries(undefined, now).map(({ heading }) => heading)).toEqual([
      '14:21 (events 4 to 18)',
      '14:40 (events 19 to 27)',
    ])
    expect(newEntries(now, now)).toEqual([])
  })
})

describe('whose episodes a file holds', () => {
  const id = 'session-38b4bbc5-ad88-46fb-bee0-5e4527e65414'

  it("names a conversation's file of a day by the beginning of its id", () => {
    expect(episodeFile('2026-11-20', id)).toBe('episodes/2026-11-20/38b4bbc5.md')
  })

  it("tells the conversation's own episodes, of any day, from those of others and from what is known", () => {
    expect(isEpisodeOf('episodes/2026-11-19/38b4bbc5.md', id)).toBe(true)
    expect(isEpisodeOf('episodes/2026-11-20/44924cbe.md', id)).toBe(false)
    expect(isEpisodeOf('projects/38b4bbc5.md', id)).toBe(false)
  })
})

describe('consolidateRequest', () => {
  const share = { indexLines: 200, indexBytes: 25600, fit: undefined }
  const kept = { directory: '/memory-transcripts', days: 7 }
  const nothingNew = { added: [], compared: false, days: 30, scribes: false }

  it('says how large the index is', () => {
    const fit = { lines: 57, bytes: 25114, left: 0, firstLeft: undefined }
    expect(consolidateRequest(undefined, { ...share, fit }, kept, nothingNew)).toContain(
      '- MEMORY.md is 57 lines and 25114 bytes now. Every night is told this as it starts.',
    )
    expect(consolidateRequest(undefined, share, kept, nothingNew)).not.toContain('bytes now')
  })

  it('says which lines of the index a conversation is not given', () => {
    const one = {
      lines: 58,
      bytes: 25714,
      left: 1,
      firstLeft: '- Calling an LLM directly: [llm-apis.md](llm-apis.md)',
    }
    expect(consolidateRequest(undefined, { ...share, fit: one }, kept, nothingNew)).toContain(
      '- MEMORY.md is 58 lines and 25714 bytes now: a conversation is not given the last line, which begins "- Calling an LLM directly: [llm-apis.md]". Every night is told',
    )
    const three = { lines: 60, bytes: 26900, left: 3, firstLeft: '- 環境の構成' }
    expect(consolidateRequest(undefined, { ...share, fit: three }, kept, nothingNew)).toContain(
      'a conversation is not given the last 3 lines, from the one that begins "- 環境の構成" on.',
    )
  })

  it('says where in a file that grew the new entries start', () => {
    const text = consolidateRequest(undefined, share, kept, {
      added: [
        { file: 'episodes/2026-11-16/aaaa.md', from: '19:17 (events 40 to 52)' },
        { file: 'episodes/2026-11-16/bbbb.md' },
      ],
      compared: true,
      days: 30,
      scribes: true,
    })
    expect(text).toContain(
      '- episodes/2026-11-16/aaaa.md, from the entry headed "19:17 (events 40 to 52)" on: the entries before it are already part of what is known',
    )
    expect(text).toContain('- episodes/2026-11-16/bbbb.md\n')
  })

  it('says it holds the scribes only where it does', () => {
    const episodes = { added: [], compared: false, days: 30 }
    expect(consolidateRequest(undefined, share, kept, { ...episodes, scribes: true })).toContain(
      'also holds the scribes',
    )
    expect(
      consolidateRequest(undefined, share, kept, { ...episodes, scribes: false }),
    ).not.toContain('scribes of the day')
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

  it('names a line shown under an earlier entry by its place', () => {
    const line = {
      file: 'projects/mail.md',
      line: 2,
      text: '- postbox drops what is over 200 a day.',
    }
    const text = compareRequest([
      {
        file: 'episodes/2026-11-15/1234.md',
        heading: '14:21 (events 4 to 18)',
        entry: 'Sent 50 with postbox.',
        lines: [line],
      },
      {
        file: 'episodes/2026-11-15/5678.md',
        heading: '15:00 (events 2 to 6)',
        entry: 'postbox sent all 320.',
        lines: [line],
      },
    ])
    expect(text.split(line.text)).toHaveLength(2)
    expect(text).toContain('1. projects/mail.md:2 (shown above)')
  })
})

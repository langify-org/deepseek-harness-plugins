import { describe, expect, it } from 'vitest'
import { broughtUp, hunchesOf, hunchText, QUIET, watcherRequest, watcherSystem } from './hunch.ts'

const hunches = hunchesOf({
  'hunches/think-aloud.md':
    '# Thinking aloud\n\nCues: the user passes over what was offered and widens the question.\n',
  'hunches/empty.md': '  \n',
  'MEMORY.md': '# Memory\n',
  'hunches/bank-transfer.md': '# Frozen before a task\n\nCues: the user has not started a task.\n',
})

describe('hunchesOf', () => {
  it('takes the hunch files that say something, by name', () => {
    expect(hunches.map(({ file }) => file)).toEqual([
      'hunches/bank-transfer.md',
      'hunches/think-aloud.md',
    ])
  })

  it('gives the watcher every hunch under its file name', () => {
    const system = watcherSystem(hunches)
    expect(system).toContain('=== hunches/think-aloud.md ===\n# Thinking aloud')
    expect(system).toContain(QUIET)
  })
})

/** The files of the hunches the watcher's `reply` brings up. */
function named(reply: string): string[] {
  return broughtUp(reply, hunches).map(({ file }) => file)
}

describe('broughtUp', () => {
  it('is nothing when the watcher is quiet', () => {
    expect(named(` ${QUIET}\n`)).toEqual([])
    expect(named('')).toEqual([])
  })

  it('is nothing when the watcher names no hunch it was given', () => {
    expect(named('The user may want to think aloud.')).toEqual([])
    expect(named('hunches/made-up.md')).toEqual([])
  })

  it('takes the hunches the watcher named, one to a line', () => {
    expect(named('hunches/think-aloud.md\nhunches/bank-transfer.md\n')).toEqual([
      'hunches/bank-transfer.md',
      'hunches/think-aloud.md',
    ])
  })

  it('knows a hunch by its file name when the watcher shortens it', () => {
    expect(named('think-aloud')).toEqual(['hunches/think-aloud.md'])
    expect(named('Seen before (think-aloud).')).toEqual(['hunches/think-aloud.md'])
    expect(named('bank-transfer.md')).toEqual(['hunches/bank-transfer.md'])
    // A name inside a sentence is just a word.
    expect(named('The user may want to think-aloud here.')).toEqual([])
  })
})

describe('what the watcher is shown and what it brings up', () => {
  it('says which hunches the conversation was given before, only when there are some', () => {
    expect(watcherRequest('', 'User: hi', [])).not.toContain('before, so not')
    expect(watcherRequest('', 'User: hi', ['hunches/a.md', 'hunches/b.md'])).toContain(
      'not to be brought up again: hunches/a.md, hunches/b.md',
    )
  })

  it('gives a conversation each hunch as it was written, under its file', () => {
    const text = hunchText(broughtUp('hunches/think-aloud.md', hunches))
    expect(text.startsWith('<memory-hunch>')).toBe(true)
    expect(text).toContain('not what to do now')
    expect(text).toContain(
      '=== hunches/think-aloud.md ===\n# Thinking aloud\n\nCues: the user passes over what was offered and widens the question.',
    )
    expect(text).not.toContain('bank-transfer')
  })
})

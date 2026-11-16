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

describe('broughtUp', () => {
  it('is nothing when the watcher is quiet', () => {
    expect(broughtUp(` ${QUIET}\n`, hunches)).toBeUndefined()
    expect(broughtUp('', hunches)).toBeUndefined()
  })

  it('is nothing when the watcher names no hunch it was given', () => {
    expect(broughtUp('The user may want to think aloud.', hunches)).toBeUndefined()
    expect(broughtUp('Seen before (hunches/made-up.md).', hunches)).toBeUndefined()
  })

  it('knows a hunch by its file name when the watcher shortens it', () => {
    expect(broughtUp('Seen before (think-aloud).', hunches)?.files).toEqual([
      'hunches/think-aloud.md',
    ])
    expect(broughtUp('Seen before: bank-transfer.md', hunches)?.files).toEqual([
      'hunches/bank-transfer.md',
    ])
    // A name alone, outside parentheses, is just a word.
    expect(broughtUp('The user may want to think-aloud here.', hunches)).toBeUndefined()
  })

  it('names the hunches the watcher drew on', () => {
    const reply =
      'Last time a question was widened like this, the user wanted to think it through, not be given a step (hunches/think-aloud.md).'
    expect(broughtUp(`${reply}\n`, hunches)).toEqual({
      text: reply,
      files: ['hunches/think-aloud.md'],
    })
  })
})

describe('what the watcher is shown and what it brings up', () => {
  it('says which hunches the conversation was given before, only when there are some', () => {
    expect(watcherRequest('', 'User: hi', [])).not.toContain('before, so not')
    expect(watcherRequest('', 'User: hi', ['hunches/a.md', 'hunches/b.md'])).toContain(
      'not to be brought up again: hunches/a.md, hunches/b.md',
    )
  })

  it('gives a conversation what was brought up as a recollection', () => {
    const text = hunchText('Seen before (hunches/think-aloud.md).')
    expect(text.startsWith('<memory-hunch>')).toBe(true)
    expect(text).toContain('not what to do now')
    expect(text).toContain('Seen before (hunches/think-aloud.md).')
  })
})

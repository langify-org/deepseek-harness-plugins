import { describe, expect, it } from 'vitest'
import { splitMessage } from './split.ts'

describe('splitMessage', () => {
  it('keeps short text whole and drops blank text', () => {
    expect(splitMessage('hello\nworld')).toEqual(['hello\nworld'])
    expect(splitMessage('  \n ')).toEqual([])
  })

  it('cuts at line breaks within the limit', () => {
    const parts = splitMessage('aaaa\nbbbb\ncccc', 10)
    expect(parts).toEqual(['aaaa\nbbbb', 'cccc'])
  })

  it('cuts a line longer than the limit', () => {
    const parts = splitMessage('x'.repeat(25), 10)
    expect(parts).toEqual(['x'.repeat(10), 'x'.repeat(10), 'x'.repeat(5)])
  })

  it('closes and reopens a code block cut in two', () => {
    const text = [
      'intro',
      '```ts',
      'const a = 1',
      'const b = 2',
      'const c = 3',
      '```',
      'outro',
    ].join('\n')
    const parts = splitMessage(text, 30)
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(30)
      // Every part has balanced fences.
      expect((part.match(/^```/gm) ?? []).length % 2).toBe(0)
    }
    expect(parts[1]?.startsWith('```ts\n')).toBe(true)
    expect(parts.join('\n').replaceAll(/\n?```(ts)?\n?/g, '')).toContain('const c = 3')
  })

  it('never exceeds the limit with a long line inside a code block', () => {
    const text = `\`\`\`\n${'y'.repeat(50)}\n\`\`\``
    const parts = splitMessage(text, 20)
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(20)
    expect(parts.join('').replaceAll(/`|\n/g, '')).toBe('y'.repeat(50))
  })
})

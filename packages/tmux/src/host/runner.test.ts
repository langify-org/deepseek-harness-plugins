import { describe, expect, it, vi } from 'vitest'
import { Focus, isCommandLine } from './runner.ts'

describe('isCommandLine', () => {
  it('takes one printable line, and refuses control characters', () => {
    expect(isCommandLine("just test 'a b' 日本")).toBe(true)
    expect(isCommandLine('just test\nrm -rf ~')).toBe(false)
    expect(isCommandLine('just \u001b[A')).toBe(false)
    expect(isCommandLine('  ')).toBe(false)
  })
})

describe('Focus', () => {
  it('gives a window once, and only while it is fresh', () => {
    vi.useFakeTimers()
    const focus = new Focus()
    focus.set('s1', '@3')
    expect(focus.take('s1')).toBe('@3')
    expect(focus.take('s1')).toBeUndefined()
    focus.set('s1', '@4')
    vi.advanceTimersByTime(11_000)
    expect(focus.take('s1')).toBeUndefined()
    vi.useRealTimers()
  })
})

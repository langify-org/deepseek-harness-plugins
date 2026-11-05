import { describe, expect, it } from 'vitest'
import { MouseModes, wheel } from './mouse.ts'

describe('MouseModes', () => {
  it('reports only with a tracking mode and SGR on', () => {
    const modes = new MouseModes()
    modes.read('\u001b[?1000h')
    expect(modes.reports).toBe(false)
    modes.read('text\u001b[?1002;1006hmore')
    expect(modes.reports).toBe(true)
    modes.read('\u001b[?1006l')
    expect(modes.reports).toBe(false)
  })

  it('follows tmux turning modes off and on again', () => {
    const modes = new MouseModes()
    modes.read('\u001b[?1000h\u001b[?1006h')
    modes.read('\u001b[?1006l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1006h\u001b[?1000h')
    expect(modes.reports).toBe(true)
  })
})

describe('wheel', () => {
  it('writes SGR wheel reports', () => {
    expect(wheel(true, 3, 7)).toBe('\u001b[<64;3;7M')
    expect(wheel(false, 1, 1)).toBe('\u001b[<65;1;1M')
  })
})

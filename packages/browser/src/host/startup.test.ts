import { describe, expect, it } from 'vitest'
import { parseDevToolsActivePort } from './chromium.ts'
import { parseDisplayNumber } from './display.ts'

describe('parseDisplayNumber', () => {
  it('reads the number once Xvnc has written its whole line', () => {
    expect(parseDisplayNumber('')).toBeUndefined()
    expect(parseDisplayNumber('1')).toBeUndefined()
    expect(parseDisplayNumber('12\n')).toBe(12)
  })
})

describe('parseDevToolsActivePort', () => {
  it('turns the file into the browser WebSocket on loopback', () => {
    expect(parseDevToolsActivePort('33941\n/devtools/browser/865c53f1-e3ee-41cf\n')).toBe(
      'ws://127.0.0.1:33941/devtools/browser/865c53f1-e3ee-41cf',
    )
  })

  it('rejects a partly written or foreign file', () => {
    expect(parseDevToolsActivePort('33941')).toBeUndefined()
    expect(parseDevToolsActivePort('0\n/devtools/browser/x')).toBeUndefined()
    expect(parseDevToolsActivePort('33941\n/devtools/page/x')).toBeUndefined()
    expect(parseDevToolsActivePort('33941\n/devtools/browser/x?y=@evil')).toBeUndefined()
  })
})

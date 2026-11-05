import { describe, expect, it } from 'vitest'
import { ClipboardWrites } from './osc52.ts'

const osc52 = (text: string, end = '\u0007'): string =>
  `\u001b]52;c;${Buffer.from(text).toString('base64')}${end}`

describe('ClipboardWrites', () => {
  it('reads copies with either terminator, around other output', () => {
    const writes = new ClipboardWrites()
    expect(writes.read(`ls\r\n${osc52('hello 日本')}more${osc52('two', '\u001b\\')}`)).toEqual([
      'hello 日本',
      'two',
    ])
  })

  it('joins a sequence split across chunks, even inside its start', () => {
    const writes = new ClipboardWrites()
    const sequence = osc52('split')
    expect(writes.read(`out${sequence.slice(0, 3)}`)).toEqual([])
    expect(writes.read(sequence.slice(3, 12))).toEqual([])
    expect(writes.read(`${sequence.slice(12)}after`)).toEqual(['split'])
  })

  it('ignores queries, clears and invalid data', () => {
    const writes = new ClipboardWrites()
    expect(writes.read('\u001b]52;c;?\u0007\u001b]52;c;\u0007\u001b]52;c;%%%\u0007')).toEqual([])
    expect(writes.read('\u001b]52;;aGk=\u0007')).toEqual(['hi'])
  })
})

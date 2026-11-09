import { describe, expect, it } from 'vitest'
import { attachment, safeFileName, uniqueFileName } from './files.ts'

describe('safeFileName', () => {
  it('keeps a name to one path segment of its own folder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('_.._etc_passwd')
    expect(safeFileName('..\\..\\boot.ini')).toBe('_.._boot.ini')
    expect(safeFileName('.bashrc')).toBe('bashrc')
    expect(safeFileName('a\u0000b\nc\u007f.txt')).toBe('abc.txt')
  })

  it('never returns an empty name', () => {
    expect(safeFileName('..', 'download')).toBe('download')
    expect(safeFileName('  ')).toBe('file')
  })

  it('shortens long names to 200 bytes without splitting a character, keeping the extension', () => {
    const name = safeFileName(`${'👨‍👩‍👧'.repeat(30)}.pdf`)
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(200)
    expect(name.endsWith('.pdf')).toBe(true)
    expect(name.slice(0, -'.pdf'.length)).toMatch(/^(👨‍👩‍👧)+$/u)
  })
})

describe('uniqueFileName', () => {
  it('numbers a taken name before its extension', () => {
    expect(uniqueFileName('a.txt', new Set())).toBe('a.txt')
    expect(uniqueFileName('a.txt', new Set(['a.txt', 'a (2).txt']))).toBe('a (3).txt')
    expect(uniqueFileName('README', new Set(['README']))).toBe('README (2)')
  })
})

describe('attachment', () => {
  it('names the file in UTF-8 with an ASCII fallback that cannot end the quoted string', () => {
    expect(attachment('売上 "(2026)".csv')).toBe(
      `attachment; filename="__ _(2026)_.csv"; filename*=UTF-8''%E5%A3%B2%E4%B8%8A%20%22%282026%29%22.csv`,
    )
  })
})

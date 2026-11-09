import { describe, expect, it } from 'vitest'
import { keySpec, openableUrl } from './tools.ts'

describe('openableUrl', () => {
  it('opens http and https, and a bare host as the address bar would', () => {
    expect(openableUrl('http://example.com/a')).toBe('http://example.com/a')
    expect(openableUrl(' example.com/path ')).toBe('https://example.com/path')
    expect(openableUrl('localhost:8080/app')).toBe('http://localhost:8080/app')
    expect(openableUrl('127.0.0.1:5000')).toBe('http://127.0.0.1:5000/')
    expect(openableUrl('about:blank')).toBe('about:blank')
  })

  it('refuses every other scheme', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'chrome://settings',
      'data:text/html,x',
    ]) {
      expect(() => openableUrl(url)).toThrow(/Only http and https/)
    }
  })
})

describe('keySpec', () => {
  it('gives named keys, function keys and characters their DOM key, code and key code', () => {
    expect(keySpec('Enter')).toEqual({ key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' })
    expect(keySpec('F5')).toEqual({ key: 'F5', code: 'F5', keyCode: 116 })
    expect(keySpec('a')).toEqual({ key: 'a', code: 'KeyA', keyCode: 65, text: 'a' })
    expect(keySpec('7')).toEqual({ key: '7', code: 'Digit7', keyCode: 55, text: '7' })
    expect(keySpec('🎌')).toEqual({ key: '🎌', code: '', keyCode: 0, text: '🎌' })
  })

  it('refuses a key it does not know', () => {
    expect(() => keySpec('Hyper')).toThrow(/Unknown key/)
  })
})

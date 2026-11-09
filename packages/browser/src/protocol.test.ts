import { describe, expect, it } from 'vitest'
import { MAX_SIZE, MIN_SIZE, clampSize, clientMessage, tabQuery } from './protocol.ts'

describe('clientMessage', () => {
  it('accepts sizes within the screen limits only', () => {
    expect(clientMessage.safeParse({ type: 'show', ...MIN_SIZE }).success).toBe(true)
    expect(clientMessage.safeParse({ type: 'show', width: 8000, height: 600 }).success).toBe(false)
    expect(clientMessage.safeParse({ type: 'resize', width: 800.5, height: 600 }).success).toBe(
      false,
    )
  })

  it('bounds typed text', () => {
    expect(clientMessage.safeParse({ type: 'text', text: '' }).success).toBe(false)
    expect(clientMessage.safeParse({ type: 'text', text: 'x'.repeat(65_537) }).success).toBe(false)
  })
})

describe('tabQuery', () => {
  it('takes a conversation id of plain characters only', () => {
    expect(tabQuery.safeParse({ session: 'a-1_B', tab: 'x' }).success).toBe(true)
    expect(tabQuery.safeParse({ session: 'a/../b', tab: 'x' }).success).toBe(false)
    expect(tabQuery.safeParse({ session: 'a', tab: '' }).success).toBe(false)
  })
})

describe('clampSize', () => {
  it('keeps a tab’s size within the limits, whatever the page measured', () => {
    expect(clampSize(Number.NaN, 0)).toEqual(MIN_SIZE)
    expect(clampSize(99_999, 99_999)).toEqual(MAX_SIZE)
    expect(clampSize(800.4, 600.6)).toEqual({ width: 800, height: 601 })
  })
})

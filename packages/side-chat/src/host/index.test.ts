import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { sideChatProjection } from './index.ts'

const message = (kind: string): UserMessage =>
  createUserMessage({ content: [{ type: 'text', text: '…' }], source: { kind } as never })
const spliced = (seq: number, inserted: UserMessage[]): SessionEvent =>
  ({
    type: 'agent/inbox/spliced',
    seq,
    time: 0,
    data: { target: 'next-step', start: 0, inserted },
  }) as SessionEvent
const userMessage = (seq: number, kind: string): SessionEvent =>
  ({ type: 'user/message', seq, time: 0, data: message(kind) }) as SessionEvent

/** The projected view after folding `events` over a log with `inherited` inherited events. */
function view(inherited: number, events: SessionEvent[]): unknown {
  const { init, apply, wire } = sideChatProjection
  return wire.view(events.reduce(apply, init({}, inherited)))
}

describe('sideChatProjection', () => {
  it('marks a session from the moment the context enters its inbox', () => {
    expect(view(3, [spliced(3, [message('langify-side-chat')])])).toBe(true)
    expect(view(3, [userMessage(3, 'langify-side-chat')])).toBe(true)
  })

  it('ignores other messages and a context inherited from a forked side chat', () => {
    expect(view(3, [spliced(3, [message('user')]), userMessage(4, 'user')])).toBe(false)
    expect(view(3, [userMessage(2, 'langify-side-chat'), userMessage(3, 'user')])).toBe(false)
  })

  it('keeps the same state for unrelated events, so nothing republishes', () => {
    const state = sideChatProjection.init({}, 0)
    expect(sideChatProjection.apply(state, userMessage(0, 'user'))).toBe(state)
  })
})

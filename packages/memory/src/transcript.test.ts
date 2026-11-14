import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { renderTranscript, unreadFrom } from './transcript.ts'

const limits = { toolArguments: 20, toolResult: 10 }

/** Events as the log holds them, with only the fields the transcript reads. */
function events(...data: object[]): SessionEvent[] {
  return data.map((event, seq) => Object.assign({ seq, time: 0 }, event) as unknown as SessionEvent)
}

const user = (kind: string, text: string): object => ({
  type: 'user/message',
  data: { role: 'user', content: [{ type: 'text', text }], source: { kind } },
})

describe('renderTranscript', () => {
  it('keeps what people asked for and leaves out injected context', () => {
    const text = renderTranscript(
      events(
        user('instructions', 'AGENTS.md contents'),
        user('user', 'remember that I use NixOS'),
        user('schedule', 'check the backups'),
      ),
      limits,
    )
    expect(text).toBe(
      '### User\nremember that I use NixOS\n\n### Scheduled instruction\ncheck the backups',
    )
  })

  it('cuts tool traffic short, and leaves out reasoning', () => {
    const text = renderTranscript(
      events(
        {
          type: 'assistant/message',
          data: {
            message: {
              content: [
                { type: 'reasoning', text: 'thinking' },
                { type: 'text', text: 'Reading it.' },
                {
                  type: 'tool-call',
                  id: 'c1',
                  name: 'read',
                  arguments: '{"path":\n "/a/very/long/path/to/a/file"}',
                },
              ],
            },
          },
        },
        {
          type: 'tool/result',
          data: { message: { content: [{ type: 'text', text: '0123456789abc' }], isError: true } },
        },
      ),
      limits,
    )
    expect(text).toBe(
      '### Assistant\nReading it.\n- tool call: read {"path": "/a/very/lo… (39 chars)\n\n- tool error: 0123456789… (13 chars)',
    )
  })

  it('says how a turn ended unless it completed, and is empty when nothing happened', () => {
    expect(
      renderTranscript(events({ type: 'turn/end', data: { reason: { kind: 'aborted' } } }), limits),
    ).toBe('(The turn ended: aborted.)')
    expect(
      renderTranscript(
        events(
          { type: 'turn/start', data: {} },
          { type: 'turn/end', data: { reason: { kind: 'completed' } } },
        ),
        limits,
      ),
    ).toBe('')
  })
})

describe('unreadFrom', () => {
  const log = events(
    { type: 'turn/start', data: {} },
    user('user', 'one'),
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { type: 'turn/start', data: {} },
    user('user', 'two'),
    { type: 'turn/end', data: { reason: { kind: 'completed' } } },
    { type: 'turn/start', data: {} },
  )

  it('continues after what was read', () => {
    expect(unreadFrom(log, 2, 5)).toBe(3)
  })

  it('starts a conversation it never read at the turn that ended, not at a later one', () => {
    expect(unreadFrom(log, undefined, 5)).toBe(3)
    expect(unreadFrom(log, undefined, 2)).toBe(0)
  })
})

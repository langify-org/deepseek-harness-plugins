import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { renderContext, renderTranscript, unreadFrom } from './transcript.ts'

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

/** An assistant message that says `text` and calls a tool. */
const said = (text: string): object => ({
  type: 'assistant/message',
  data: {
    message: {
      content: [
        { type: 'text', text },
        { type: 'tool-call', id: 'c', name: 'read', arguments: '{}' },
      ],
    },
  },
})

describe('renderContext', () => {
  const result = {
    type: 'tool/result',
    data: { message: { content: [{ type: 'text', text: 'file contents' }] } },
  }
  const log = events(
    user('user', 'first question'),
    said('first answer'),
    result,
    user('user', 'OK'),
  )

  it('keeps what was said and leaves out the tool traffic', () => {
    expect(renderContext(log, 1000)).toBe(
      '### User\nfirst question\n\n### Assistant\nfirst answer\n\n### User\nOK',
    )
  })

  it('keeps the newest parts that fit, and says that older ones were left out', () => {
    expect(renderContext(log, 40)).toBe(
      '(Earlier parts are left out.)\n\n### Assistant\nfirst answer\n\n### User\nOK',
    )
  })

  it('keeps the end of a newest part longer than the limit, and is empty when nothing was said', () => {
    expect(renderContext(events(user('user', 'abcdefghij')), 4)).toBe('…ghij')
    expect(renderContext(events(result), 100)).toBe('')
  })
})

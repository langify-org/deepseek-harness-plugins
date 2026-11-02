import { describe, expect, it, vi } from 'vitest'
import type { API } from '@discordjs/core'
import { ComponentType, InteractionType } from '@discordjs/core'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import { parseCustomId, type Outbox } from './discord.ts'
import {
  askApproval,
  askQuestions,
  type ComponentInteraction,
  PendingRequests,
  type QuestionContext,
} from './interactive.ts'

const questions: AskUserQuestionItem[] = [
  { id: 'color', question: 'Which color?', options: [{ label: 'Red' }, { label: 'Blue' }] },
  { id: 'name', question: 'Your name?' },
]

/** Fakes that record what was sent and let a test click what was sent. */
function harness() {
  const sent: { content: string; ids: string[] }[] = []
  type Body = { content: string; components?: unknown[] }
  const send = vi.fn<(channel: string, body: Body) => Promise<{ id: string }>>(
    async (_channel, body) => {
      sent.push({
        content: body.content,
        ids: JSON.stringify(body.components ?? []).match(/dsh:[^"]+/g) ?? [],
      })
      return { id: `m${sent.length}` }
    },
  )
  const outbox = {
    send,
    text: vi.fn<() => Promise<void>>(async () => undefined),
  } as unknown as Outbox
  const createModal = vi.fn<() => Promise<void>>(async () => undefined)
  const editMessage = vi.fn<() => Promise<object>>(async () => ({}))
  const api = {
    interactions: { updateMessage: vi.fn<() => Promise<void>>(async () => undefined), createModal },
    channels: { editMessage },
  } as unknown as API
  const pending = new PendingRequests()
  const click = async (interaction: ComponentInteraction, id: string): Promise<void> => {
    const parsed = parseCustomId(id)
    if (parsed === undefined) throw new Error(`bad id ${id}`)
    await pending.get(parsed.nonce)?.handle(interaction, parsed.action)
  }
  return { sent, send, outbox, api, pending, click, createModal, editMessage }
}

const button = {
  id: 'i',
  token: 't',
  type: InteractionType.MessageComponent,
  data: { component_type: ComponentType.Button },
} as unknown as ComponentInteraction
const modal = (value: string) =>
  ({
    id: 'i',
    token: 't',
    type: InteractionType.ModalSubmit,
    data: {
      custom_id: 'x',
      components: [
        {
          type: ComponentType.Label,
          component: { type: ComponentType.TextInput, custom_id: 'text', value },
        },
      ],
    },
  }) as unknown as ComponentInteraction

const flush = () => new Promise((resolve) => setImmediate(resolve))

describe('askQuestions', () => {
  it('answers the waiting tool once every question has an answer', async () => {
    const h = harness()
    const context = { ctx: {}, sessionId: 'discord-1' } as unknown as QuestionContext
    const answer = askQuestions(h.api, h.outbox, h.pending, '1', context, { questions }, () =>
      Promise.reject(new Error('should not delegate')),
    )
    await flush()
    const blue = h.sent[0]?.ids.find((id) => id.endsWith(':q0:o1'))
    const other = h.sent[1]?.ids.find((id) => id.endsWith(':q1:other'))
    await h.click(button, blue ?? '')
    await h.click(button, other ?? '')
    expect(h.createModal).toHaveBeenCalled()
    await h.click(modal('Ada'), other?.replace(':other', ':text') ?? '')
    await expect(answer).resolves.toEqual({
      answers: [
        { id: 'color', selected: ['Blue'] },
        { id: 'name', selected: [], custom: 'Ada' },
      ],
    })
  })

  it('steers late answers into the session after a timed wait expires', async () => {
    const h = harness()
    const agent = { id: 'discord-1' }
    const answerContinued = vi.fn<(...args: unknown[]) => boolean>(() => true)
    const context = {
      ctx: {
        agents: { get: () => agent },
        userQuestions: { answer: answerContinued },
        logger: { warn: vi.fn<() => void>() },
      },
      sessionId: 'discord-1',
    } as unknown as QuestionContext
    const controller = new AbortController()
    const asked = askQuestions(
      h.api,
      h.outbox,
      h.pending,
      '1',
      context,
      {
        questions: [questions[0]!],
        signal: controller.signal,
        wait: { callId: 'c1', timed: true },
      } as never,
      () => Promise.reject(new Error('should not delegate')),
    )
    await flush()
    controller.abort(new Error('timed out'))
    await expect(asked).rejects.toThrow('timed out')
    await h.click(button, h.sent[0]?.ids.find((id) => id.endsWith(':q0:o0')) ?? '')
    expect(answerContinued).toHaveBeenCalledWith(agent, 'c1', {
      answers: [{ id: 'color', selected: ['Red'] }],
    })
  })

  it('hands the question to DSH when the plugin unloads', async () => {
    const h = harness()
    const context = { ctx: {}, sessionId: 'discord-1' } as unknown as QuestionContext
    const delegated = { answers: [{ id: 'color', selected: ['Red'] }] }
    const asked = askQuestions(
      h.api,
      h.outbox,
      h.pending,
      '1',
      context,
      { questions: [questions[0]!] },
      () => Promise.resolve(delegated),
    )
    await flush()
    h.pending.releaseAll()
    await expect(asked).resolves.toBe(delegated)
  })
})

const request = (signal?: AbortSignal) =>
  ({ agent: {}, toolName: 'bash', ...(signal ? { signal } : {}) }) as never

describe('askApproval', () => {
  it('allows once or denies by button', async () => {
    for (const [action, outcome] of [
      ['allow', 'allowed-once'],
      ['deny', 'rejected'],
    ] as const) {
      const h = harness()
      const asked = askApproval(h.api, h.outbox, h.pending, '1', request(), () =>
        Promise.resolve('unavailable'),
      )
      await flush()
      await h.click(button, h.sent[0]?.ids.find((id) => id.endsWith(`:${action}`)) ?? '')
      await expect(asked).resolves.toBe(outcome)
    }
  })

  it('is cancelled when the request is withdrawn', async () => {
    const h = harness()
    const controller = new AbortController()
    const asked = askApproval(h.api, h.outbox, h.pending, '1', request(controller.signal), () =>
      Promise.resolve('unavailable'),
    )
    await flush()
    controller.abort()
    await expect(asked).resolves.toBe('cancelled')
    expect(h.editMessage).toHaveBeenCalled()
  })

  it('falls back to DSH when Discord is unreachable', async () => {
    const h = harness()
    h.send.mockRejectedValueOnce(new Error('offline'))
    await expect(
      askApproval(h.api, h.outbox, h.pending, '1', request(), () =>
        Promise.resolve('allowed-once'),
      ),
    ).resolves.toBe('allowed-once')
  })
})

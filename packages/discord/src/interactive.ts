// Tool approvals and ask_user_question, answered with buttons in the thread.
import { randomUUID } from 'node:crypto'
import type { Services } from './services.ts'
import type { Context } from '@deepseek-ai/cordis'
import {
  type API,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIMessage,
  type APIMessageComponentInteraction,
  type APISelectMenuOption,
  type APIModalSubmitInteraction,
  type APIStringSelectComponent,
  ButtonStyle,
  ComponentType,
  InteractionType,
  TextInputStyle,
} from '@discordjs/core'
import type { ApprovalOutcome, ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import type {
  AskUserQuestionAnswer,
  AskUserQuestionAnswerItem,
  AskUserQuestionItem,
  AskUserQuestionRequestEvent,
} from '@deepseek-ai/dsh-user-questions/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { button, customId, modalText, type Outbox, rows, truncate } from './discord.ts'

export type ComponentInteraction = APIMessageComponentInteraction | APIModalSubmitInteraction

/** One request waiting for buttons. */
interface Pending {
  handle(interaction: ComponentInteraction, action: string): Promise<void>
  /** The plugin is unloading: hand the request to the next answerer. */
  release(): void
}

/** Requests waiting for an answer in Discord, by the nonce in their `custom_id`s. */
export class PendingRequests {
  private readonly pending = new Map<string, Pending>()

  get(nonce: string): Pending | undefined {
    return this.pending.get(nonce)
  }

  add(nonce: string, entry: Pending): void {
    this.pending.set(nonce, entry)
  }

  delete(nonce: string): void {
    this.pending.delete(nonce)
  }

  releaseAll(): void {
    for (const entry of this.pending.values()) entry.release()
    this.pending.clear()
  }
}

/**
 * Asks for a tool approval in the thread. Allow means once, as in DSH's own
 * dialog. Withdrawing the request strikes the buttons.
 */
export async function askApproval(
  api: API,
  outbox: Outbox,
  pending: PendingRequests,
  threadId: string,
  request: ApprovalRequestEvent,
  next: () => Promise<ApprovalOutcome>,
): Promise<ApprovalOutcome> {
  const nonce = randomUUID()
  const reason = request.displayReason?.en ?? request.reason
  const content = truncate(
    `🔐 Allow **${request.toolName}**?${reason === undefined ? '' : `\n${reason}`}`,
    1900,
  )
  let message: APIMessage
  try {
    message = await outbox.send(threadId, {
      content,
      components: rows([
        button('Allow', customId(nonce, 'allow'), ButtonStyle.Success),
        button('Deny', customId(nonce, 'deny'), ButtonStyle.Danger),
      ]),
    })
  } catch {
    // Discord is unreachable: let DSH's own dialog ask instead.
    return next()
  }

  const strike = (note: string): void => {
    void api.channels
      .editMessage(threadId, message.id, { content: `${content}\n→ ${note}`, components: [] })
      .catch(() => undefined)
  }

  return new Promise<ApprovalOutcome>((resolve) => {
    const settle = (outcome: Promise<ApprovalOutcome> | ApprovalOutcome): void => {
      pending.delete(nonce)
      request.signal?.removeEventListener('abort', onAbort)
      resolve(outcome)
    }
    const onAbort = (): void => {
      strike('Withdrawn')
      settle('cancelled')
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    pending.add(nonce, {
      async handle(interaction, action) {
        const allowed = action === 'allow'
        settle(allowed ? 'allowed-once' : 'rejected')
        await api.interactions.updateMessage(interaction.id, interaction.token, {
          content: `${content}\n→ ${allowed ? 'Allowed' : 'Denied'}`,
          components: [],
        })
      },
      release() {
        strike('Moved to DSH')
        settle(next())
      },
    })
    if (request.signal?.aborted === true) onAbort()
  })
}

/** Where a question's answer goes once the batch is complete. */
export interface QuestionContext {
  readonly ctx: Context & Services
  readonly sessionId: SessionId
}

/**
 * Asks ask_user_question's questions in the thread, one message each. While
 * the tool waits, the answers return through the waterfall. After a timed
 * wait expires, DSH keeps the question open ("continued"), and the answers
 * are steered into the session instead, as DSH's own reply does.
 */
export async function askQuestions(
  api: API,
  outbox: Outbox,
  pending: PendingRequests,
  threadId: string,
  { ctx, sessionId }: QuestionContext,
  request: AskUserQuestionRequestEvent,
  next: () => Promise<AskUserQuestionAnswer>,
): Promise<AskUserQuestionAnswer> {
  const nonce = randomUUID()
  const batch = new AnswerBatch(request.questions)
  const messages: { id: string; content: string }[] = []
  try {
    for (const [index, question] of request.questions.entries()) {
      if (question.detail !== undefined) await outbox.text(threadId, question.detail)
      const content = questionText(question)
      const message = await outbox.send(threadId, {
        content,
        components: questionComponents(question, nonce, index),
      })
      messages.push({ id: message.id, content })
    }
  } catch {
    // Discord is unreachable: let DSH's own form ask instead.
    return next()
  }

  const strike = (note: string): void => {
    for (const [index, message] of messages.entries()) {
      if (batch.has(index)) continue
      void api.channels
        .editMessage(threadId, message.id, {
          content: `${message.content}\n→ ${note}`,
          components: [],
        })
        .catch(() => undefined)
    }
  }

  return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
    let waiting = true
    const onAbort = (): void => {
      waiting = false
      // Rejecting lets DSH report the timeout or withdrawal as usual. A timed
      // question stays answerable here; any other withdrawal ends it.
      reject(request.signal?.reason)
      if (request.wait?.timed === true) return
      pending.delete(nonce)
      strike('Withdrawn')
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    const finish = (answer: AskUserQuestionAnswer): void => {
      pending.delete(nonce)
      request.signal?.removeEventListener('abort', onAbort)
      if (waiting) {
        resolve(answer)
        return
      }
      const callId = request.wait?.callId
      const agent = ctx.agents.get(sessionId)
      let delivered = false
      try {
        delivered =
          callId !== undefined &&
          agent !== undefined &&
          ctx.userQuestions.answer(agent, callId, answer)
      } catch (error) {
        ctx.logger.warn(`discord: could not deliver the answer: ${String(error)}`)
      }
      if (!delivered)
        void outbox.text(threadId, 'This question was already closed.').catch(() => undefined)
    }

    pending.add(nonce, {
      async handle(interaction, action) {
        const parsed = /^q(\d+):(.+)$/.exec(action)
        const index = Number(parsed?.[1])
        const question = request.questions[index]
        const message = messages[index]
        const kind = parsed?.[2]
        if (question === undefined || message === undefined || kind === undefined) return
        if (kind === 'other') {
          await api.interactions.createModal(interaction.id, interaction.token, {
            custom_id: customId(nonce, `q${index}:text`),
            title: truncate(question.header ?? 'Answer', 45),
            components: [
              {
                type: ComponentType.Label,
                label: truncate(question.question, 45),
                component: {
                  type: ComponentType.TextInput,
                  custom_id: 'text',
                  style: TextInputStyle.Paragraph,
                  required: true,
                },
              },
            ],
          })
          return
        }
        const item = itemFrom(question, kind, interaction)
        if (item === undefined) return
        batch.set(index, item)
        await api.interactions.updateMessage(interaction.id, interaction.token, {
          content: truncate(`${message.content}\n→ ${describe(item)}`, 2000),
          components: [],
        })
        const answer = batch.result()
        if (answer !== undefined) finish(answer)
      },
      release() {
        strike('Moved to DSH')
        if (waiting) resolve(next())
      },
    })
    if (request.signal?.aborted === true) onAbort()
  })
}

/** Collects one answer per question, in the questions' order. */
export class AnswerBatch {
  private readonly answers = new Map<number, AskUserQuestionAnswerItem>()
  private readonly questions: readonly AskUserQuestionItem[]

  constructor(questions: readonly AskUserQuestionItem[]) {
    this.questions = questions
  }

  has(index: number): boolean {
    return this.answers.has(index)
  }

  set(index: number, item: AskUserQuestionAnswerItem): void {
    if (index >= 0 && index < this.questions.length) this.answers.set(index, item)
  }

  /** The complete answer, or undefined while a question is unanswered. */
  result(): AskUserQuestionAnswer | undefined {
    const answers: AskUserQuestionAnswerItem[] = []
    for (const index of this.questions.keys()) {
      const item = this.answers.get(index)
      if (item === undefined) return undefined
      answers.push(item)
    }
    return { answers }
  }
}

/** The answer an interaction gives to one question, by the action in its `custom_id`. */
export function itemFrom(
  question: AskUserQuestionItem,
  kind: string,
  interaction: ComponentInteraction,
): AskUserQuestionAnswerItem | undefined {
  const labels = (question.options ?? []).map((option) => option.label)
  if (kind === 'text') {
    if (interaction.type !== InteractionType.ModalSubmit) return undefined
    return { id: question.id, selected: [], custom: modalText(interaction.data) }
  }
  if (kind === 'select') {
    if (interaction.type !== InteractionType.MessageComponent) return undefined
    if (interaction.data.component_type !== ComponentType.StringSelect) return undefined
    const selected = interaction.data.values.flatMap((value) => labels[Number(value)] ?? [])
    return { id: question.id, selected }
  }
  const option = /^o(\d+)$/.exec(kind)
  const label = option === null ? undefined : labels[Number(option[1])]
  return label === undefined ? undefined : { id: question.id, selected: [label] }
}

function describe(item: AskUserQuestionAnswerItem): string {
  const parts = item.selected.map((label) => `**${label}**`)
  if (item.custom !== undefined) parts.push(item.custom)
  return parts.length === 0 ? '(nothing)' : parts.join(', ')
}

function questionText(question: AskUserQuestionItem): string {
  const lines = [
    `❓ ${question.header === undefined ? '' : `**${question.header}** — `}${question.question}`,
  ]
  for (const option of question.options ?? []) {
    if (option.description !== undefined) lines.push(`- **${option.label}**: ${option.description}`)
  }
  return truncate(lines.join('\n'), 1900)
}

/**
 * Single choice: a button per option. Multiple choice: one select menu.
 * Every question also offers a free-text answer.
 */
export function questionComponents(
  question: AskUserQuestionItem,
  nonce: string,
  index: number,
): APIActionRowComponent<APIComponentInMessageActionRow>[] {
  const options = question.options ?? []
  const other = button(
    options.length === 0 ? 'Answer…' : 'Other…',
    customId(nonce, `q${index}:other`),
    ButtonStyle.Secondary,
  )
  if (options.length === 0) return rows([other])
  if (question.multiSelect === true || options.length > 19) {
    const menu: APIStringSelectComponent = {
      type: ComponentType.StringSelect,
      custom_id: customId(nonce, `q${index}:select`),
      min_values: 1,
      max_values: question.multiSelect === true ? Math.min(options.length, 25) : 1,
      options: options.slice(0, 25).map((option, i) => {
        const choice: APISelectMenuOption = { label: truncate(option.label, 100), value: String(i) }
        if (option.description !== undefined) choice.description = truncate(option.description, 100)
        return choice
      }),
    }
    return [...rows([menu]), ...rows([other])]
  }
  const approve = question.intent?.approve
  return rows([
    ...options.map((option, i) =>
      button(
        option.label,
        customId(nonce, `q${index}:o${i}`),
        option.label === approve ? ButtonStyle.Success : ButtonStyle.Primary,
      ),
    ),
    other,
  ])
}

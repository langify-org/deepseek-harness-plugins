// Small helpers over @discordjs/core shared by the inbound, outbound and
// interactive halves.
import {
  type API,
  type APIActionRowComponent,
  type APIButtonComponentWithCustomId,
  type APIComponentInMessageActionRow,
  type APIMessage,
  type APIModalSubmission,
  ButtonStyle,
  ComponentType,
  type RESTPostAPIChannelMessageJSONBody,
} from '@discordjs/core'
import { splitMessage } from './split.ts'

/** The Session that a bot-made thread talks to. Only these Sessions are bridged. */
export function sessionIdOf(threadId: string): string {
  return `discord-${threadId}`
}

/** The thread of a bridged Session, or undefined for every other Session. */
export function threadOf(sessionId: string): string | undefined {
  return sessionId.startsWith('discord-') ? sessionId.slice('discord-'.length) : undefined
}

/**
 * Sends messages one channel at a time, in call order, so a question never
 * overtakes the answer text that came before it. Mentions never ping anyone:
 * the text comes from the model.
 */
export class Outbox {
  private readonly tails = new Map<string, Promise<unknown>>()
  private readonly api: API

  constructor(api: API) {
    this.api = api
  }

  send(channelId: string, body: RESTPostAPIChannelMessageJSONBody): Promise<APIMessage> {
    const run = (this.tails.get(channelId) ?? Promise.resolve()).then(() =>
      this.api.channels.createMessage(channelId, { ...body, allowed_mentions: { parse: [] } }),
    )
    const tail = run.catch(() => undefined)
    this.tails.set(channelId, tail)
    void tail.then(() => {
      if (this.tails.get(channelId) === tail) this.tails.delete(channelId)
    })
    return run
  }

  /** Sends text in as many messages as it takes. */
  async text(channelId: string, text: string): Promise<void> {
    for (const content of splitMessage(text)) await this.send(channelId, { content })
  }
}

/** `custom_id` of a component: the pending request's nonce and the action. */
export function customId(nonce: string, action: string): string {
  return `dsh:${nonce}:${action}`
}

export function parseCustomId(id: string): { nonce: string; action: string } | undefined {
  const match = /^dsh:([^:]+):(.*)$/.exec(id)
  return match?.[1] === undefined || match[2] === undefined
    ? undefined
    : { nonce: match[1], action: match[2] }
}

export function button(
  label: string,
  id: string,
  style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger,
): APIButtonComponentWithCustomId {
  return { type: ComponentType.Button, label: truncate(label, 80), custom_id: id, style }
}

/** Lays components out in rows of five, at most five rows. */
export function rows<T extends APIComponentInMessageActionRow>(
  components: readonly T[],
): APIActionRowComponent<T>[] {
  const out: APIActionRowComponent<T>[] = []
  for (let i = 0; i < components.length && out.length < 5; i += 5) {
    out.push({ type: ComponentType.ActionRow, components: components.slice(i, i + 5) })
  }
  return out
}

/** The first text input's value in a submitted modal, in either layout. */
export function modalText(data: APIModalSubmission): string {
  for (const row of data.components) {
    if (row.type === ComponentType.ActionRow) {
      const input = row.components[0]
      if (input !== undefined) return input.value
    } else if (row.type === ComponentType.Label && row.component.type === ComponentType.TextInput) {
      return row.component.value
    }
  }
  return ''
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

export { ButtonStyle }

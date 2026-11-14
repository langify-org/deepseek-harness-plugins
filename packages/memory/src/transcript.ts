// What the scribe reads of a conversation: the people's words and the work in
// between, with tool traffic cut short, and before it what was said earlier, as
// context. Context the harness injected (instruction files, skills, notices) is
// left out of both: it is not something that happened.
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** How much of each tool call and result the transcript keeps. */
export interface TranscriptLimits {
  /** Characters of a tool call's arguments. */
  readonly toolArguments: number
  /** Characters of a tool result. */
  readonly toolResult: number
}

/** User-role messages that someone asked for, by their source kind, and how each is headed. */
const PROMPTS: Readonly<Record<string, string>> = {
  user: 'User',
  schedule: 'Scheduled instruction',
}

/**
 * The first event the scribe has not read, up to `to`: the one after `read`, the
 * last event it was given. A conversation it has never been given starts at the
 * turn that just ended: what came before is from before the plugin was there.
 */
export function unreadFrom(
  events: readonly SessionEvent[],
  read: number | undefined,
  to: number,
): number {
  if (read !== undefined) return read + 1
  let from = 0
  for (const event of events) {
    if (event.seq > to) break
    if (event.type === 'turn/start') from = event.seq
  }
  return from
}

/** The events as text, oldest first; empty when nothing in them is worth reading. */
export function renderTranscript(
  events: readonly SessionEvent[],
  limits: TranscriptLimits,
): string {
  return parts(events, limits).join('\n\n')
}

/**
 * What was said in the events, without the tool traffic: the newest of it that
 * fits in `limit` characters, saying so when older parts were left out. Empty
 * when nothing was said.
 */
export function renderContext(events: readonly SessionEvent[], limit: number): string {
  const all = parts(events, undefined)
  const kept: string[] = []
  let length = 0
  for (const part of all.toReversed()) {
    // The newest part alone may be longer than the limit: keep its end.
    const text = kept.length === 0 && part.length > limit ? `…${part.slice(-limit)}` : part
    if (length + text.length > limit && kept.length > 0) break
    kept.unshift(text)
    length += text.length + 2
  }
  if (kept.length === 0) return ''
  return [...(kept.length < all.length ? ['(Earlier parts are left out.)'] : []), ...kept].join(
    '\n\n',
  )
}

/** The events' parts, oldest first. Without `limits`, tool calls and results are left out. */
function parts(events: readonly SessionEvent[], limits: TranscriptLimits | undefined): string[] {
  const rendered: string[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        const heading = PROMPTS[event.data.source.kind]
        if (heading === undefined) break
        const text = blocksText(event.data.content)
        if (text !== '') rendered.push(`### ${heading}\n${text}`)
        break
      }
      case 'assistant/message': {
        const lines: string[] = []
        for (const block of event.data.message.content) {
          if (block.type === 'text' && block.text.trim() !== '') lines.push(block.text.trim())
          if (block.type === 'tool-call' && limits !== undefined)
            lines.push(`- tool call: ${block.name} ${cut(block.arguments, limits.toolArguments)}`)
        }
        if (lines.length > 0) rendered.push(`### Assistant\n${lines.join('\n')}`)
        break
      }
      case 'tool/result': {
        if (limits === undefined) break
        const { message } = event.data
        const label = message.isError === true ? 'tool error' : 'tool result'
        rendered.push(`- ${label}: ${cut(blocksText(message.content), limits.toolResult)}`)
        break
      }
      case 'turn/end': {
        const { kind } = event.data.reason
        if (kind !== 'completed') rendered.push(`(The turn ended: ${kind}.)`)
        break
      }
      default:
        break
    }
  }
  return rendered
}

/** The readable text of message content; attachments are named, not included. */
function blocksText(content: readonly ContentBlock[]): string {
  const texts: string[] = []
  for (const block of content) {
    if (block.type === 'text') texts.push(block.text)
    else if (block.type === 'image') texts.push('[image]')
    else if (block.type === 'file') texts.push(`[file: ${block.attachment.name}]`)
  }
  return texts.join('\n').trim()
}

/** `text` on one line, at most `limit` characters of it. */
function cut(text: string, limit: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length <= limit ? line : `${line.slice(0, limit)}… (${line.length} chars)`
}

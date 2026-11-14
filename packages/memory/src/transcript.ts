// What the scribe reads of a conversation: the people's words and the work in
// between, with tool traffic cut short. Context the harness injected (instruction
// files, skills, notices) is left out: it is not something that happened.
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

/** The events as text, oldest first; empty when nothing in them is worth reading. */
export function renderTranscript(
  events: readonly SessionEvent[],
  limits: TranscriptLimits,
): string {
  const parts: string[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user/message': {
        const heading = PROMPTS[event.data.source.kind]
        if (heading === undefined) break
        const text = blocksText(event.data.content)
        if (text !== '') parts.push(`### ${heading}\n${text}`)
        break
      }
      case 'assistant/message': {
        const lines: string[] = []
        for (const block of event.data.message.content) {
          if (block.type === 'text' && block.text.trim() !== '') lines.push(block.text.trim())
          if (block.type === 'tool-call')
            lines.push(`- tool call: ${block.name} ${cut(block.arguments, limits.toolArguments)}`)
        }
        if (lines.length > 0) parts.push(`### Assistant\n${lines.join('\n')}`)
        break
      }
      case 'tool/result': {
        const { message } = event.data
        const label = message.isError === true ? 'tool error' : 'tool result'
        parts.push(`- ${label}: ${cut(blocksText(message.content), limits.toolResult)}`)
        break
      }
      case 'turn/end': {
        const { kind } = event.data.reason
        if (kind !== 'completed') parts.push(`(The turn ended: ${kind}.)`)
        break
      }
      default:
        break
    }
  }
  return parts.join('\n\n')
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

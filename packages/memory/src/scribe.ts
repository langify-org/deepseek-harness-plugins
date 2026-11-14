// What the plugin says to the memory agents and what it writes for them: the
// first files of the memory directory, the messages that hand a scribe its
// conversation part by part, the message that asks for the directory to be
// tidied, and the commit message made from the reply that ends a turn.
//
// What every memory agent needs to know of the plugin's mechanisms is the memory
// preset's system prompt (cordis.patch.yml). What one agent is there to do is the
// beginning of its first message, here. What to remember is the user's, in the
// directory's AGENTS.md, which the plugin only starts and quotes.

/** The file that holds the user's guidance, and the one that holds the index. */
export const GUIDANCE_FILE = 'AGENTS.md'
export const INDEX_FILE = 'MEMORY.md'

/** The user's guidance as it starts: what memory is for, not how to keep it. */
export const AGENTS_MD: string = `# Memory

This directory is the memory of DeepSeek Harness: what was learned in every conversation with this user.
It exists so that future sessions working with this user do not ask the same things again or repeat the same mistakes.

- Conversation logs are the source of truth; memory is derived from them.
- Where memory and an AGENTS.md the user wrote elsewhere disagree, that AGENTS.md is right.
- Write memory, and your replies, in the language the user speaks.
- Most conversations that are given the beginning of ${INDEX_FILE} are about something else. It holds what such a conversation needs: who the user is, what is going on in a line each, and where the details are. Where a task stands from one moment to the next belongs in the task's own file.
`

/** The index before anything is remembered. */
export const MEMORY_MD = `# Memory

Nothing is remembered yet.
`

/** What a scribe is there to do: the beginning of its first message. */
const SCRIBE = `You record one conversation, part by part. This message gives you the user's guidance, the beginning of the index, what the conversation said before you came to it, and the first part to record. After each later turn of the conversation, a message gives you the next part, after the names of the files that other agents changed since your last turn.

Write to the directory when the user asks for something to be remembered, or when a part holds something clearly worth remembering: something you expect a later conversation to need. Most parts hold nothing of the kind, and then you change nothing.

The part to record comes last in a message: it starts after a line that names its events, like "=== events 12 to 34 ===", and runs to the end of the message. You stay with this conversation for the day. The agent that takes your place afterwards starts from the directory and the last of what the conversation said, not from what you have in mind.`

/** How much of the index every conversation is given. */
export interface IndexShare {
  readonly indexLines: number
  readonly indexBytes: number
}

/**
 * The first message of a day's memory conversation: tidy the directory. It is
 * the conversation's only turn; after it the conversation holds the day's scribes.
 */
export function tidyRequest(guidance: string | undefined, share: IndexShare): string {
  return [
    `You tidy the memory directory. Through the day, conversations wrote to it: each had a scribe that saw only its own conversation, a turn at a time, without knowing what would matter later or what the other scribes wrote. You have the whole directory and the time to read all of it. Leave it as a later conversation would want to find it.`,
    '',
    '- A later conversation needs how things stand and what was learned, not the order in which it came out. Notes written a turn at a time pile up as a chronicle: drafts that were replaced, states that have since changed, the same thing in several places.',
    `- The beginning of ${INDEX_FILE} (at most ${share.indexLines} lines or ${share.indexBytes} bytes) is all that most conversations ever read of memory, and most of them are about something else: it has to be short, and to say where the rest is.`,
    '- You cannot see the conversations the notes came from, so you can mark a note you doubt, but not correct it.',
    '- Nothing you remove is lost: the directory keeps every earlier state in its history, and the user can go back to any of them. You cannot read that history.',
    '- Notes say when they were written, and the time now is given to you.',
    '',
    ...(guidance === undefined
      ? []
      : [`The user's guidance, ${GUIDANCE_FILE}:`, '', guidance.trim(), '']),
    'This conversation also holds the scribes of the day that follows, as its subagents. When this turn ends it has nothing more to do.',
  ].join('\n')
}

/** Where the conversation came from, and which of its events the transcript covers. */
export interface ScribeSource {
  readonly sessionId: string
  readonly title: string | undefined
  readonly cwd: string | undefined
  /** First event in the transcript, inclusive. */
  readonly from: number
  /** Last event in the transcript, inclusive. */
  readonly to: number
}

/** Memory as a scribe starts from it. */
export interface ScribeMemory extends IndexShare {
  /** The user's guidance file; undefined when there is none. */
  readonly guidance: string | undefined
  /** The beginning of the index, as conversations are given it; undefined when there is none. */
  readonly index: string | undefined
}

/**
 * The line a part to record starts after. It names the part's events, so nothing
 * said earlier in the conversation can pass for it, and the part needs no closing
 * line: it runs to the end of the message.
 */
function partLine(source: ScribeSource): string {
  return `=== events ${source.from} to ${source.to} ===`
}

/**
 * A new scribe's first message: what it starts from, then the first part to
 * record. `context` is what the conversation said before that part, which
 * earlier scribes were offered.
 */
export function firstRequest(
  source: ScribeSource,
  memory: ScribeMemory,
  context: string,
  transcript: string,
): string {
  const title = source.title === undefined ? '' : ` "${source.title}"`
  const cwd = source.cwd === undefined ? '' : `, working in ${source.cwd}`
  const given = `at most ${memory.indexLines} lines or ${memory.indexBytes} bytes`
  return [
    SCRIBE,
    '',
    ...(memory.guidance === undefined
      ? []
      : [`The user's guidance, ${GUIDANCE_FILE}:`, '', memory.guidance.trim(), '']),
    ...(memory.index === undefined
      ? [`There is no ${INDEX_FILE}. Conversations are given its beginning (${given}).`, '']
      : [
          `The beginning of ${INDEX_FILE}, as conversations are given it (${given}):`,
          '',
          memory.index,
          '',
        ]),
    `The conversation you record: session ${source.sessionId}${title}${cwd}.`,
    ...(context === ''
      ? [`The part to record follows the line "${partLine(source)}".`]
      : [
          `What it said before event ${source.from} follows, without the tool calls: it was already offered for recording. After it, the part to record follows the line "${partLine(source)}".`,
          '',
          context,
        ]),
    '',
    partLine(source),
    transcript,
  ].join('\n')
}

/**
 * A scribe's message for a later turn of its conversation: the next part to
 * record, after the files of memory that others changed since its last turn.
 */
export function nextRequest(
  source: ScribeSource,
  changed: readonly string[],
  transcript: string,
): string {
  return [
    ...(changed.length === 0
      ? []
      : [`Changed by others since your last turn: ${changed.join(', ')}.`, '']),
    partLine(source),
    transcript,
  ].join('\n')
}

/** The trailer that names a conversation a commit learned from. */
export const SOURCE_TRAILER = 'Memory-Source'

/** A commit message from the reply that ended the turn, naming the conversations it came from. */
export function commitMessage(reply: string, sources: readonly string[]): string {
  const body = reply.trim() === '' ? 'Update memory' : reply.trim()
  const trailers = [...new Set(sources)].map((id) => `${SOURCE_TRAILER}: ${id}`)
  return trailers.length === 0 ? `${body}\n` : `${body}\n\n${trailers.join('\n')}\n`
}

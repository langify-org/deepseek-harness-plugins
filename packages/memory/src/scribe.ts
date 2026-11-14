// What the plugin says to the memory agents and what it writes for them: the
// first files of the memory directory, the request that hands a scribe part of a
// conversation, and the commit message made from the reply that ends a turn.
//
// What the plugin's mechanisms need an agent to know is the memory preset's
// system prompt (cordis.patch.yml), which changes with the plugin. What to
// remember is the user's, in the directory's AGENTS.md, which the plugin only
// starts and quotes.

/** The file that holds the user's guidance, and the one that holds the index. */
export const GUIDANCE_FILE = 'AGENTS.md'
export const INDEX_FILE = 'MEMORY.md'

/** The user's guidance as it starts: what memory is for, not how to keep it. */
export const AGENTS_MD = `# Memory

This directory is the memory of DeepSeek Harness: what was learned in every conversation with this user.
It exists so that future sessions working with this user do not ask the same things again or repeat the same mistakes.

- Conversation logs are the source of truth; memory is derived from them.
- Where memory and an AGENTS.md the user wrote elsewhere disagree, that AGENTS.md is right.
- Write in the language the user speaks.
`

/** The index before anything is remembered. */
export const MEMORY_MD = `# Memory

Nothing is remembered yet.
`

/** The one message a day's memory conversation is given: it only holds that day's scribes. */
export const MEMORY_CONVERSATION = `This conversation holds today's memory scribes: each is a subagent that records part of a conversation into this directory, started by the memory plugin. Nothing else happens here.
Reply with one short sentence saying so, and do nothing else.
`

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
export interface ScribeMemory {
  /** The user's guidance file; undefined when there is none. */
  readonly guidance: string | undefined
  /** The beginning of the index, as conversations are given it; undefined when there is none. */
  readonly index: string | undefined
  /** How much of the index conversations are given. */
  readonly indexLines: number
  readonly indexBytes: number
}

/** A scribe's request to update memory from one transcript. */
export function scribeRequest(
  source: ScribeSource,
  memory: ScribeMemory,
  transcript: string,
): string {
  const title = source.title === undefined ? '' : ` "${source.title}"`
  const cwd = source.cwd === undefined ? '' : `, working in ${source.cwd}`
  const given = `at most ${memory.indexLines} lines or ${memory.indexBytes} bytes`
  return [
    ...(memory.guidance === undefined
      ? []
      : [
          `The user's guidance, ${GUIDANCE_FILE}:`,
          '',
          '<guidance>',
          memory.guidance.trim(),
          '</guidance>',
          '',
        ]),
    ...(memory.index === undefined
      ? [`There is no ${INDEX_FILE}. Conversations are given its beginning (${given}).`, '']
      : [
          `The beginning of ${INDEX_FILE}, as conversations are given it (${given}):`,
          '',
          '<index>',
          memory.index,
          '</index>',
          '',
        ]),
    `A conversation went on: session ${source.sessionId}${title}${cwd}, events ${source.from} to ${source.to}.`,
    'Update memory from it if anything is worth remembering.',
    '',
    '<transcript>',
    transcript,
    '</transcript>',
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

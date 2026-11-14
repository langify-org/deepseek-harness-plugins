// What the plugin says to the memory agents and what it writes for them: the
// first files of the memory directory, the request that hands the scribe part of
// a conversation, and the commit message made from the reply that ends a turn.

/** The memory agents' instructions: what memory is for, not how to keep it. */
export const AGENTS_MD = `# Memory

This directory is the memory of DeepSeek Harness: what was learned in every conversation with this user.
It exists so that future sessions working with this user do not ask the same things again or repeat the same mistakes.

- \`MEMORY.md\` is the index. Its beginning (200 lines or 25 KB) is given to every session when it starts, so it should show what is known and where to find it. The rest of the directory is organized as you see fit.
- Conversation logs are the source of truth; memory is derived from them.
- Where memory and an AGENTS.md the user wrote disagree, the AGENTS.md is right.
- Never write secrets (tokens, passwords, keys).
- Write in the language the user speaks with you.
- This AGENTS.md is the user's; leave it as it is.
- The reply that ends your turn becomes the commit message of your changes, and other sessions are told about them with it: write it for them. If you changed nothing, say only that.
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

/** The scribe's request to update memory from one transcript. */
export function scribeRequest(source: ScribeSource, transcript: string): string {
  const title = source.title === undefined ? '' : ` "${source.title}"`
  const cwd = source.cwd === undefined ? '' : `, working in ${source.cwd}`
  return [
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

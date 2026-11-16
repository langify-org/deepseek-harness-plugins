// What the plugin says to the memory agents and what it writes for them: the
// first files of the memory directory, the messages that hand a scribe its
// conversation part by part, the entries it makes of a scribe's replies, the
// message that asks for what is known to be brought up to date, and commit
// messages.
//
// What every memory agent needs to know of the plugin's mechanisms is the memory
// preset's system prompt (cordis.patch.yml). What one agent is there to do is the
// beginning of its first message, here. What to remember is the user's, in the
// directory's AGENTS.md, which the plugin only starts and quotes.

import { HUNCHES, QUESTIONS_FILE } from './hunch.ts'
import type { NoteLine } from './related.ts'

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

/** The directory, in the memory directory, of what the scribes note: the record, never rewritten. */
export const EPISODES = 'episodes'

/** A scribe's whole reply to a part that holds nothing to note. */
export const NOTHING = '(nothing)'

/** What a scribe is there to do: the beginning of its first message. */
const SCRIBE = `You note one conversation, part by part, as it goes. This message gives you the user's guidance, the beginning of the index of what is known, what the conversation said before you came to it, and the first part. After each later turn of the conversation, a message gives you the next part.

Your reply to a part is its entry in the day's record of this conversation. The memory plugin puts it, under a heading that gives the time and the part's events, at the end of a file in ${EPISODES}/ that is not rewritten afterwards; you write no file yourself. A later conversation finds the entry when it searches for what was said, and tonight another agent brings what is known up to date from the day's entries. Neither sees this conversation, so the entry has to stand on its own and hold what they need from it and cannot get elsewhere: what was decided and why, what was learned and how it is known, what was promised and for which date, what changed and from what; and where the user corrected the assistant, passed over what it offered or was pleased by what it did, what the assistant had done and the user's words as they were said. A reader on another day cannot tell which day "tomorrow" was. A part that holds nothing of the kind gets no entry: reply with exactly ${NOTHING}. Most parts do.

The part comes last in a message: it starts after a line that names its events, like "=== events 12 to 34 ===", and runs to the end of the message. You stay with this conversation for the day, and what you noted before is in your own replies.`

/** How much of the index every conversation is given. */
export interface IndexShare {
  readonly indexLines: number
  readonly indexBytes: number
}

/** Where the parts the scribes were given are kept, and for how many days. */
export interface Kept {
  readonly directory: string
  readonly days: number
}

/** One entry of an episode, and the lines of what is known that share the most words with it. */
export interface Compared {
  readonly file: string
  /** The entry's heading: when it was noted and the events it is about. */
  readonly heading: string
  readonly entry: string
  readonly lines: readonly NoteLine[]
}

/** The entries of a file of episodes: each heading and what was noted under it. */
export function episodeEntries(text: string): { heading: string; entry: string }[] {
  return text
    .split(/^## /m)
    .slice(1)
    .map((part) => {
      const [heading = '', ...rest] = part.split('\n')
      return { heading: heading.trim(), entry: rest.join('\n').trim() }
    })
    .filter(({ entry }) => entry !== '')
}

/**
 * The entries of a file of episodes that it did not hold at `before`, its text
 * when what is known was last brought up to date; undefined when the file was
 * not there then. Episodes are only appended to, so what is new is what came
 * after: a file that gained one entry is not read again from its first.
 */
export function newEntries(
  before: string | undefined,
  now: string,
): { heading: string; entry: string }[] {
  const known = new Set(episodeEntries(before ?? '').map(({ heading }) => heading))
  return episodeEntries(now).filter(({ heading }) => !known.has(heading))
}

/** A line of a note as it is shown beside something it may be about. */
export function shown(line: NoteLine): string {
  const text = line.text.length <= LINE_CHARS ? line.text : `${line.text.slice(0, LINE_CHARS)}…`
  return `${line.file}:${line.line}: ${text}`
}

/** How much of a long line is shown; the rest is in its file. */
const LINE_CHARS = 400

/**
 * The message before what is known is brought up to date: each new entry beside
 * the lines of what is known that it may be about, and the question whether they
 * agree. A model that only has two notes in front of it does not compare them;
 * asked about the pair, it does.
 */
export function compareRequest(compared: readonly Compared[]): string {
  return [
    `Before what memory knows is brought up to date, compare. Below are the entries that scribes noted from conversations since the last time. Under each are the lines of what is known that share the most words with it: some are about the same thing, some only look so.`,
    '',
    'For each entry, name the lines it disagrees with or makes out of date, and say in a sentence what each side says. Say nothing about the other lines; where there is none, say: none. Change no file yet: the next message asks for the changes.',
    ...compared.flatMap(({ file, heading, entry, lines }) => [
      '',
      `=== ${file}, ${heading} ===`,
      entry,
      '',
      ...(lines.length === 0
        ? ['(No line of what is known shares words with it.)']
        : lines.map((line, index) => `${index + 1}. ${shown(line)}`)),
    ]),
  ].join('\n')
}

/** A file of episodes with entries that what is known does not hold yet. */
export interface Added {
  /** The file, as a path in the memory directory. */
  readonly file: string
  /** The heading of its first such entry, when the entries before it are part of what is known. */
  readonly from?: string | undefined
}

/** The episodes that what is known does not hold yet, and how long episodes stay. */
export interface Episodes {
  readonly added: readonly Added[]
  /** Whether their entries were just compared with what is known. */
  readonly compared: boolean
  readonly days: number
  /** Whether the conversation brought up to date also holds the day's scribes. */
  readonly scribes: boolean
}

/**
 * The first message of a day's memory conversation: bring what is known up to
 * date from the episodes. It is the conversation's only turn; after it the
 * conversation holds the day's scribes.
 */
export function consolidateRequest(
  guidance: string | undefined,
  share: IndexShare,
  kept: Kept,
  episodes: Episodes,
): string {
  return [
    `You bring what memory knows up to date. The directory holds two kinds of files. Those in ${EPISODES}/ are the record: what a scribe noted of each conversation as it went, a file for each conversation and day. They stay as they are. All the others are what is known: how things stand and what was learned, by subject, with ${INDEX_FILE} as their index. Now what the new episodes hold becomes part of what is known. Leave what is known as a later conversation would want to find it.`,
    '',
    ...(episodes.added.length === 0
      ? ['No episodes were added since the last time.']
      : [
          'Episodes added since the last time:',
          ...episodes.added.map(({ file, from }) =>
            from === undefined
              ? `- ${file}`
              : `- ${file}, from the entry headed "${from}" on: the entries before it are already part of what is known`,
          ),
        ]),
    '',
    `- A later conversation is given the beginning of ${INDEX_FILE} (at most ${share.indexLines} lines or ${share.indexBytes} bytes) and reads the file it names for the subject at hand. It reads an episode only when it searches. So what an episode established has to be where that conversation will look: under the subject it is about, which is often not the conversation it came up in. What was learned about a tool while working on one project is needed by the next project that uses the tool.`,
    ...(episodes.compared
      ? [
          '- You have just compared the new entries with what was known. A decision or a state of things can change, and then what is known says the new one. A statement about how something works does not become true by being newer, or by who made it: where two of those disagree, one of them is wrong, and which is not known until it is checked against the thing itself, the code or the document. Until then both places say that they disagree and what the other says, so that a conversation that reads only one of them is not misled.',
        ]
      : []),
    `- An episode holds why something was decided and how something is known. What is known can say it in a few words and name the episode's file for the rest.`,
    `- Episodes older than ${episodes.days} days leave the directory. What is to be known for longer has to be in a file outside ${EPISODES}/ by then.`,
    '- What was promised or planned for a day has to be where a conversation on that day sees it without looking for it.',
    `- Some of what conversations taught is not how things stand but how to act in a kind of moment: what the user wanted done or not done, what went wrong, what went better than expected. That goes in ${HUNCHES}/, a file for each kind of moment. Conversations are not given these files: a small model that watches each conversation brings one up when its moment comes again. A hunch says by which cues the moment can be told as it happens (in what the user says or does, what the assistant is about to do, what a tool shows), not what was understood afterwards; what happened in it, with the user's words quoted as they were said, the date and the episode; and why it may matter, as a reading that can be wrong. It says what happened, not what to do. One that a single moment taught says so.`,
    '- A hunch comes from a surprise, either way: the user corrected something, passed over what was offered, or was pleased by something; the assistant was wrong; a tool showed what was not expected.',
    "- Hunches that expect the same in moments alike are one hunch with all the moments in it. Hunches that expect differently are about different moments: find what tells the moments apart and put it in their cues. Where hunches are merged or shortened, the user's words stay. A line elsewhere that came from one kind of moment and reads as if it held in every one is given its moment: it goes into a hunch.",
    `- What memory cannot settle without the user goes in ${QUESTIONS_FILE}: where what the user said and what they did disagree, or hunches conflict and the notes cannot tell why. A question quotes what was said and where, gives the readings that are possible, and says what the answer would change. Only the few that matter; a question goes once the user has answered it.`,
    `- What the scribes were given of the conversations in the last ${kept.days} days is kept in ${kept.directory}: a directory for each day, a file for each conversation. A note you doubt can be checked there against what the conversation said.`,
    "- What one of the user's own files holds, a later conversation can read there, and memory needs only to say where it is. You can read those files too.",
    '- The time now is given to you.',
    '',
    ...(guidance === undefined
      ? []
      : [`The user's guidance, ${GUIDANCE_FILE}:`, '', guidance.trim(), '']),
    `Your reply becomes the commit message of your changes: write it for someone reading the history of memory.${episodes.scribes ? ' This conversation also holds the scribes of the day that follows, as its subagents.' : ''} When this turn ends it has nothing more to do.`,
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

/** A part as it is kept beside the directory: the conversation and its events, then the part. */
export function keptPart(source: ScribeSource, transcript: string): string {
  const title = source.title === undefined ? '' : ` "${source.title}"`
  const cwd = source.cwd === undefined ? '' : `, working in ${source.cwd}`
  return `=== events ${source.from} to ${source.to} of session ${source.sessionId}${title}${cwd} ===\n${transcript}\n\n`
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

/** A scribe's message for a later turn of its conversation: the next part. */
export function nextRequest(source: ScribeSource, transcript: string): string {
  return [partLine(source), transcript].join('\n')
}

/** How a conversation's file of episodes for one day begins. */
export function episodeHead(source: ScribeSource): string {
  const cwd = source.cwd === undefined ? '' : `, working in ${source.cwd}`
  return `# ${source.title ?? source.sessionId}\n\nNoted from the conversation ${source.sessionId}${cwd}.\n`
}

/**
 * One entry of that file: when it was noted, the events it is about, and the
 * scribe's reply. The reply's own headings go two levels down, so that only the
 * line an entry starts under is a heading of that level: nothing a scribe
 * writes can pass for the start of an entry.
 */
export function episodeEntry(source: ScribeSource, at: string, entry: string): string {
  const body = entry.trim().replaceAll(/^(?=#+ )/gm, '##')
  return `\n## ${at} (events ${source.from} to ${source.to})\n\n${body}\n`
}

/** The trailer that names a conversation a commit learned from. */
export const SOURCE_TRAILER = 'Memory-Source'

/** A commit message from the reply that ended the turn, naming the conversations it came from. */
export function commitMessage(reply: string, sources: readonly string[]): string {
  const body = reply.trim() === '' ? 'Update memory' : reply.trim()
  const trailers = [...new Set(sources)].map((id) => `${SOURCE_TRAILER}: ${id}`)
  return trailers.length === 0 ? `${body}\n` : `${body}\n\n${trailers.join('\n')}\n`
}

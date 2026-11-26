// What a conversation is given of memory: the beginning of the index when it
// starts, and afterwards which files changed.
import type { NoteLine } from './related.ts'
import { shown, SOURCE_TRAILER } from './scribe.ts'

/** How much of the index a conversation is given. */
export interface IndexLimits {
  readonly lines: number
  readonly bytes: number
}

/** One change to memory, as its commit tells it. */
export interface MemoryCommit {
  readonly hash: string
  /** The message without its trailers. */
  readonly message: string
  /** The conversations it was learned from. */
  readonly sources: readonly string[]
}

/** Field and record separators of the log format `parseCommits` reads. */
export const LOG_FORMAT = '%H%x1f%B%x1e'

const TRAILER = new RegExp(`^${SOURCE_TRAILER}: (.+)$`)

/** Commits from `git log --format=${LOG_FORMAT}`, in the order git printed them. */
export function parseCommits(output: string): MemoryCommit[] {
  return output.split('\u001e').flatMap((record) => {
    const [hash, body] = record.replace(/^\n/, '').split('\u001f')
    if (hash === undefined || body === undefined || hash === '') return []
    const sources: string[] = []
    const lines = body.trimEnd().split('\n')
    for (let match = TRAILER.exec(lines.at(-1) ?? ''); match !== null;) {
      sources.unshift(match[1] ?? '')
      lines.pop()
      match = TRAILER.exec(lines.at(-1) ?? '')
    }
    return [{ hash, message: lines.join('\n').trim(), sources }]
  })
}

/** A line of the index as the limit counts it: with its line break. */
const lineBytes = (line: string): number => Buffer.byteLength(line, 'utf8') + 1

/** The lines of the index, and how many of them from the beginning are within the limits. */
function cut(text: string, limits: IndexLimits): { lines: string[]; kept: number } {
  const lines = text.trimEnd().split('\n')
  let kept = 0
  let bytes = 0
  for (const line of lines) {
    const size = lineBytes(line)
    if (kept >= limits.lines || bytes + size > limits.bytes) break
    kept += 1
    bytes += size
  }
  return { lines, kept }
}

/** The beginning of the index within the limits, saying how much was left out. */
export function indexHead(text: string, limits: IndexLimits): string {
  const { lines, kept } = cut(text, limits)
  const head = lines.slice(0, kept).join('\n')
  const left = lines.length - kept
  return left === 0 ? head : `${head}\n\n(${left} more lines in MEMORY.md)`
}

/** How the index stands against what a conversation is given of it. */
export interface IndexFit {
  readonly lines: number
  /** As the limit counts them: every line with its line break. */
  readonly bytes: number
  /** How many lines at the end a conversation is not given. */
  readonly left: number
  /** The first of those lines; undefined when a conversation is given all of the index. */
  readonly firstLeft: string | undefined
}

/** The size of the index, and what of it the limits leave out: `indexHead`, counted. */
export function indexFit(text: string, limits: IndexLimits): IndexFit {
  const { lines, kept } = cut(text, limits)
  return {
    lines: lines.length,
    bytes: lines.reduce((sum, line) => sum + lineBytes(line), 0),
    left: lines.length - kept,
    firstLeft: lines[kept],
  }
}

const short = (hash: string): string => hash.slice(0, 7)

/** A file of episodes that what is known does not hold yet, and the conversation it is of. */
export interface Recent {
  readonly file: string
  readonly title: string
}

/** Memory as a conversation first sees it. */
export function baselineText(
  directory: string,
  version: string,
  index: string | undefined,
  recent: readonly Recent[],
): string {
  const body =
    index === undefined
      ? 'Its index, MEMORY.md, is missing.'
      : `The beginning of its index, MEMORY.md, follows; the files it points to hold the rest. The index names topics, not what was learned: earlier conversations may already have worked out what comes up in this one, and a search of the directory for the subject finds it.\n\n${index}`
  return [
    `<memory version="${short(version)}">`,
    `This is your memory of earlier conversations with this user, kept in ${directory}. You do not keep it yourself: after each of your turns, an agent records there what this conversation said that is worth remembering, including whatever the user asks you to remember.`,
    body,
    ...(recent.length === 0
      ? []
      : [
          '',
          'What is known is brought up to date once a day. What conversations noted since then is not in it yet; it is in these files:',
          ...recent.map(({ file, title }) => `- ${file}: ${title}`),
        ]),
    '</memory>',
  ].join('\n')
}

/**
 * Lines of memory beside what was just said in a conversation. A conversation
 * reads the file the index names for its subject; what another subject's file
 * holds about the same thing it does not look for.
 */
export function recallText(lines: readonly NoteLine[]): string {
  return [
    '<memory-recall>',
    'Lines of your memory that have a name from what was just said, or share the most words with it: some are about it, some only look so, and they are not all that memory holds on it. They were noted in earlier conversations, often about another subject, and may hold what the files in front of you do not. Where what you find now disagrees with one of them, the user needs to hear both.',
    ...lines.map((line) => `- ${shown(line)}`),
    '</memory-recall>',
  ].join('\n')
}

/** Lines of memory that name today's date, for a conversation's first turn of the day. */
export function todayText(date: string, lines: readonly NoteLine[]): string {
  return [
    `<memory-today date="${date}">`,
    'Lines of your memory, written before today, that name today. What conversations noted today is not among them, and it may have settled some of these: it is in the files of what was noted since.',
    ...lines.map((line) => `- ${shown(line)}`),
    '</memory-today>',
  ].join('\n')
}

/** A line as a message of `recallText` or `todayText` showed it: its file, and its text as shown. */
export interface ShownLine {
  readonly file: string
  readonly text: string
}

const SHOWN_LINE = /^- (.+?):\d+: (.*)$/
const TODAY_TAG = /^<memory-today date="([^"]+)">$/m

/**
 * What a message of `recallText` or `todayText` showed: its lines, and the
 * date of a message of the lines that name today. The conversation's own log
 * says so, and the log is what it still has when the plugin starts again.
 */
export function shownIn(text: string): { readonly date?: string; readonly lines: ShownLine[] } {
  const lines = text.split('\n').flatMap((line) => {
    const match = SHOWN_LINE.exec(line)
    return match === null ? [] : [{ file: match[1] ?? '', text: match[2] ?? '' }]
  })
  const date = TODAY_TAG.exec(text)?.[1]
  return date === undefined ? { lines } : { date, lines }
}

/**
 * What changed in memory since `from`: the files, not what was written. Most
 * changes come from conversations about something else, so a conversation is
 * told where to look and reads what concerns it.
 */
export function updateText(from: string, to: string, files: readonly string[]): string {
  return [
    `<memory-update from="${short(from)}" to="${short(to)}">`,
    `Memory changed since it was last given to you, in: ${files.join(', ')}`,
    '</memory-update>',
  ].join('\n')
}

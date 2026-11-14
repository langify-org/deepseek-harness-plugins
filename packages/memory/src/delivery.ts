// What a conversation is given of memory: the beginning of the index when it
// starts, and afterwards which files changed.
import { SOURCE_TRAILER } from './scribe.ts'

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

/** The beginning of the index within the limits, saying how much was left out. */
export function indexHead(text: string, limits: IndexLimits): string {
  const lines = text.trimEnd().split('\n')
  const kept: string[] = []
  let bytes = 0
  for (const line of lines) {
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (kept.length >= limits.lines || bytes + size > limits.bytes) break
    kept.push(line)
    bytes += size
  }
  const left = lines.length - kept.length
  return left === 0 ? kept.join('\n') : `${kept.join('\n')}\n\n(${left} more lines in MEMORY.md)`
}

const short = (hash: string): string => hash.slice(0, 7)

/** Memory as a conversation first sees it. */
export function baselineText(
  directory: string,
  version: string,
  index: string | undefined,
): string {
  const body =
    index === undefined
      ? 'Its index, MEMORY.md, is missing.'
      : `The beginning of its index, MEMORY.md, follows; the files it points to hold the rest.\n\n${index}`
  return [
    `<memory version="${short(version)}">`,
    `This is your memory of earlier conversations with this user, kept in ${directory}.`,
    body,
    '</memory>',
  ].join('\n')
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

/** The model-facing note a `sessionStart` run produces. */

export const CONTEXT_SOURCE_KIND = 'langify-session-hooks'

/** DSH bounds a notice's one-line summary to this many characters. */
const SUMMARY_MAX_CHARS = 120

export interface StartContext {
  readonly text: string
  readonly summary: string
}

/**
 * Build the note injected before the session's first model request.
 * @param cwd - the directory the session was created in.
 * @param workdir - the directory a start command chose, if any.
 * @param contexts - extra text start commands returned, in command order.
 * @returns the note, or `undefined` when there is nothing to tell the model.
 */
export function startContext(cwd: string | null, workdir: string | null, contexts: readonly string[]): StartContext | undefined {
  const parts: string[] = []
  const moved = workdir !== null && workdir !== cwd
  if (moved) {
    parts.push(
      [
        `This session's working directory is ${workdir} (prepared by a session-start hook).`,
        cwd !== null
          ? `Work there instead of the directory the session was opened in (${cwd}):`
          : 'Work there for this task:',
        'pass it as the working directory of every shell command and use paths under it for file reads and edits.',
      ].join(' '),
    )
  }
  for (const context of contexts) parts.push(context.trim())
  if (parts.length === 0) return undefined
  const summary = moved ? `Session start hook: working directory ${workdir}` : 'Session start hook added context'
  return { text: parts.join('\n\n'), summary: bound(summary) }
}

function bound(text: string): string {
  return text.length <= SUMMARY_MAX_CHARS ? text : `${text.slice(0, SUMMARY_MAX_CHARS - 1)}…`
}

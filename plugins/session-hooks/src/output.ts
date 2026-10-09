/**
 * Read the optional JSON result of a `sessionStart` command.
 *
 * Commands may print anything; only a JSON object counts as a result. It is
 * either the whole stdout or its last non-empty line, so a script can log
 * progress first and print its result last.
 */

export interface StartHookOutput {
  /** Absolute directory the session should work in. */
  readonly workdir?: string
  /** Extra text the model sees before its first request. */
  readonly context?: string
}

export interface ParsedStartOutput {
  /** The result, when stdout held a valid one. */
  readonly output?: StartHookOutput
  /** Why a JSON-looking result was rejected. */
  readonly problem?: string
}

export function parseStartOutput(stdout: string): ParsedStartOutput {
  const candidate = jsonCandidate(stdout)
  if (candidate === undefined) return {}
  let value: unknown
  try {
    value = JSON.parse(candidate)
  } catch (error) {
    return { problem: `stdout ends with invalid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { problem: 'the JSON result must be an object' }
  }
  const record = value as Record<string, unknown>
  const problems: string[] = []
  let workdir: string | undefined
  let context: string | undefined
  if (record.workdir !== undefined && record.workdir !== null) {
    if (typeof record.workdir === 'string' && record.workdir !== '') workdir = record.workdir
    else problems.push('"workdir" must be a non-empty string')
  }
  if (record.context !== undefined && record.context !== null) {
    if (typeof record.context === 'string') {
      if (record.context.trim() !== '') context = record.context
    } else problems.push('"context" must be a string')
  }
  return {
    output: { ...(workdir !== undefined ? { workdir } : {}), ...(context !== undefined ? { context } : {}) },
    ...(problems.length > 0 ? { problem: problems.join('; ') } : {}),
  }
}

function jsonCandidate(stdout: string): string | undefined {
  const trimmed = stdout.trim()
  if (trimmed === '') return undefined
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed
  const lines = trimmed.split(/\r?\n/)
  const last = lines[lines.length - 1]!.trim()
  return last.startsWith('{') && last.endsWith('}') ? last : undefined
}

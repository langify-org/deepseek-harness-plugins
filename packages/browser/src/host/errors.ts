// Failures the tabs explain to the user.
import type { Unavailable } from '../protocol.ts'

/** A program the browser needs was not found. */
export class ProgramMissing extends Error {
  readonly program: Exclude<Unavailable, 'failed'>

  constructor(program: Exclude<Unavailable, 'failed'>, command: string, cause: unknown) {
    super(`cannot find ${command}`, { cause })
    this.program = program
  }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

import type { ErrorCode } from '../rpc.ts'

/** A failure the page can explain: `code` selects its translated message. */
export class CodeServerError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
  }
}

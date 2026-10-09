/**
 * A JSON Lines record of every hook run, `<stateDir>/hooks.log`.
 *
 * DSH keeps plugin log messages only while it starts up, so this file is where
 * a user finds out what their hooks did. It rotates once to `hooks.log.1` when
 * it grows past {@link MAX_BYTES}.
 */
import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { HookEventName } from './payload.ts'
import type { RunResult } from './runner.ts'

export const MAX_BYTES = 1024 * 1024
const TAIL_CHARS = 4000

export type RunStatus = 'ok' | 'failed' | 'timed-out' | 'cancelled' | 'not-started'

export interface RunLogEntry {
  readonly time: string
  readonly event: HookEventName
  readonly sessionId: string
  /** 1-based position of the command in the event's list. */
  readonly command: number
  readonly status: RunStatus
  readonly exitCode: number | null
  readonly signal: string | null
  readonly durationMs: number
  readonly stdout: string
  readonly stderr: string
  readonly error?: string
}

export function runStatus(result: RunResult): RunStatus {
  if (result.spawnError !== undefined) return 'not-started'
  if (result.timedOut) return 'timed-out'
  if (result.aborted) return 'cancelled'
  return result.exitCode === 0 ? 'ok' : 'failed'
}

export function logEntry(event: HookEventName, sessionId: string, command: number, result: RunResult): RunLogEntry {
  return {
    time: new Date().toISOString(),
    event,
    sessionId,
    command,
    status: runStatus(result),
    exitCode: result.exitCode,
    signal: result.signal,
    durationMs: result.durationMs,
    stdout: tail(result.stdout),
    stderr: tail(result.stderr),
    ...(result.spawnError !== undefined ? { error: result.spawnError } : {}),
  }
}

export class RunLog {
  readonly file: string
  private tail: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  /** Append one entry; failures to write are passed to `onError` and never thrown. */
  append(entry: RunLogEntry, onError: (error: unknown) => void): Promise<void> {
    const write = async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const size = await stat(this.file).then(
        (stats) => stats.size,
        () => 0,
      )
      if (size > MAX_BYTES) await rename(this.file, `${this.file}.1`)
      await appendFile(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
    }
    this.tail = this.tail.then(write).catch(onError)
    return this.tail
  }
}

function tail(text: string): string {
  return text.length <= TAIL_CHARS ? text : `…${text.slice(-TAIL_CHARS)}`
}

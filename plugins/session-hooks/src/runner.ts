/**
 * Run one hook command as `<shell> -c <command>` with a JSON payload on stdin.
 *
 * The command runs in its own process group, so a timeout or cancellation stops
 * everything it started. A command whose background children keep the output
 * pipes open does not hold the hook: once the shell exits, output is collected
 * for a short drain period and then the pipes are released.
 */
import { spawn, type ChildProcess } from 'node:child_process'

export interface RunRequest {
  readonly command: string
  readonly shell: string
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly stdin: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  /** Delay between SIGTERM and SIGKILL when stopping the process group. */
  readonly killGraceMs?: number
  /** How long to keep reading output after the shell itself exited. */
  readonly drainMs?: number
}

export interface RunResult {
  /** Exit code of the shell; `null` when it was killed by a signal or never started. */
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  /** The command exceeded its timeout and was stopped. */
  readonly timedOut: boolean
  /** The caller cancelled the run (plugin shutdown or session creation abort). */
  readonly aborted: boolean
  /** The shell could not be started at all. */
  readonly spawnError?: string
  /** Collected stdout; only the tail is kept beyond {@link STDOUT_LIMIT} bytes. */
  readonly stdout: string
  /** Collected stderr; only the tail is kept beyond {@link STDERR_LIMIT} bytes. */
  readonly stderr: string
  readonly durationMs: number
}

export const STDOUT_LIMIT = 1024 * 1024
export const STDERR_LIMIT = 64 * 1024

const POSIX = process.platform !== 'win32'

/** Whether a run counts as a success: the shell started, exited 0, and was not stopped. */
export function succeeded(result: RunResult): boolean {
  return result.exitCode === 0 && !result.timedOut && !result.aborted && result.spawnError === undefined
}

/**
 * Run a command and collect its result. Never rejects: every failure is
 * reported through the result.
 */
export function runCommand(request: RunRequest): Promise<RunResult> {
  const started = performance.now()
  const killGraceMs = request.killGraceMs ?? 3_000
  const drainMs = request.drainMs ?? 1_000
  const stdout = new TailBuffer(STDOUT_LIMIT)
  const stderr = new TailBuffer(STDERR_LIMIT)

  return new Promise<RunResult>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(request.shell, ['-c', request.command], {
        cwd: request.cwd,
        env: request.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: POSIX,
        windowsHide: true,
      })
    } catch (error) {
      resolve(finished({ spawnError: message(error) }))
      return
    }

    let timedOut = false
    let aborted = false
    let spawnError: string | undefined
    let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    let drainTimer: NodeJS.Timeout | undefined

    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        if (POSIX && child.pid !== undefined) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        // The group is already gone.
      }
    }
    const stop = () => {
      signalGroup('SIGTERM')
      if (killTimer === undefined) {
        killTimer = setTimeout(() => signalGroup('SIGKILL'), killGraceMs)
        killTimer.unref()
      }
    }
    const timeout = setTimeout(() => {
      if (settled || aborted) return
      timedOut = true
      stop()
    }, request.timeoutMs)
    timeout.unref()
    const onAbort = () => {
      if (settled || timedOut) return
      aborted = true
      stop()
    }

    const settle = () => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (drainTimer !== undefined) clearTimeout(drainTimer)
      // A stopped group keeps its pending SIGKILL so stragglers that ignore SIGTERM still end.
      if (killTimer !== undefined && !timedOut && !aborted) clearTimeout(killTimer)
      request.signal?.removeEventListener('abort', onAbort)
      resolve(
        finished({
          exitCode: exit?.code ?? null,
          signal: exit?.signal ?? null,
          timedOut,
          aborted,
          ...(spawnError !== undefined ? { spawnError } : {}),
        }),
      )
    }

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))
    // A hook that never reads stdin closes the pipe early; that is not an error.
    child.stdin?.on('error', () => {})
    child.on('error', (error) => {
      spawnError = message(error)
      settle()
    })
    child.on('exit', (code, signal) => {
      exit = { code, signal }
      drainTimer = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        settle()
      }, drainMs)
      drainTimer.unref()
    })
    child.on('close', (code, signal) => {
      exit ??= { code, signal }
      settle()
    })

    if (request.signal?.aborted) onAbort()
    else request.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdin?.end(request.stdin)
  })

  function finished(fields: Partial<Omit<RunResult, 'stdout' | 'stderr' | 'durationMs'>>): RunResult {
    return {
      exitCode: null,
      signal: null,
      timedOut: false,
      aborted: false,
      ...fields,
      stdout: stdout.text(),
      stderr: stderr.text(),
      durationMs: Math.round(performance.now() - started),
    }
  }
}

/** Keeps the last `limit` bytes written to it. */
class TailBuffer {
  private chunks: Buffer[] = []
  private size = 0
  private dropped = false
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  push(chunk: Buffer): void {
    this.chunks.push(chunk)
    this.size += chunk.length
    while (this.size > this.limit && this.chunks.length > 0) {
      const head = this.chunks[0]!
      const excess = this.size - this.limit
      if (head.length <= excess) {
        this.chunks.shift()
        this.size -= head.length
      } else {
        this.chunks[0] = head.subarray(excess)
        this.size -= excess
      }
      this.dropped = true
    }
  }

  text(): string {
    const text = Buffer.concat(this.chunks).toString('utf8')
    return this.dropped ? text.replace(/^[^\n]*\n?/, '') : text
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

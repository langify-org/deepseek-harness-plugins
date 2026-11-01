// Starts code-server on demand and keeps one instance for every page.
import { rm, stat } from 'node:fs/promises'
import { get } from 'node:http'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { CodeServerError } from './errors.ts'

export interface CodeServerOptions {
  /** Executable name or path. */
  readonly command: string
  /** code-server's own default applies when omitted. */
  readonly userDataDir?: string | undefined
  /** code-server's own default applies when omitted. */
  readonly extensionsDir?: string | undefined
  /** Added to the environment of code-server and so of every extension host it starts. */
  readonly env?: Readonly<Record<string, string>> | undefined
}

/** A listening code-server; the commit names the path its WebSocket connects to. */
export interface RunningCodeServer {
  readonly socketPath: string
  readonly commit: string
}

const STARTUP_TIMEOUT_MS = 30_000
const OUTPUT = { maxBytes: 64 * 1024 }

export class CodeServer {
  readonly #subprocess: SubprocessRuntime
  readonly #options: CodeServerOptions
  readonly #socketPath: string
  readonly #extension: string
  readonly #onStarted: (server: RunningCodeServer) => () => void
  #starting: Promise<RunningCodeServer> | undefined
  #child: SubprocessHandle | undefined
  #disposed = false
  /** The CLI with its directories, once resolved, to install the extension with. */
  #cli: readonly string[] | undefined
  /** The installed VSIX's modification time and size. */
  #installed = ''
  #installing: Promise<void> = Promise.resolve()

  /**
   * @param extension - VSIX installed before every start.
   * @param onStarted - called once per process; its disposer runs when the process exits.
   */
  constructor(
    subprocess: SubprocessRuntime,
    options: CodeServerOptions,
    socketPath: string,
    extension: string,
    onStarted: (server: RunningCodeServer) => () => void,
  ) {
    this.#subprocess = subprocess
    this.#options = options
    this.#socketPath = socketPath
    this.#extension = extension
    this.#onStarted = onStarted
  }

  /** The running server, started on first use and again after it exits or fails to start. */
  ensure(): Promise<RunningCodeServer> {
    this.#starting ??= this.#start().catch((error: unknown) => {
      this.#starting = undefined
      throw error
    })
    return this.#starting
  }

  /**
   * Install the bundled extension again if its VSIX changed since it was
   * installed, so that windows opened from now on run it. Only a linked
   * development copy of the plugin changes while it runs.
   */
  syncExtension(): Promise<void> {
    const installing = this.#installing.then(async () => {
      if (this.#cli !== undefined) await this.#installExtension(this.#cli)
    })
    this.#installing = installing.catch(() => {})
    return installing
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    const child = this.#child
    this.#child = undefined
    this.#starting = undefined
    child?.terminate()
    await child?.waitForExit()
  }

  async #start(): Promise<RunningCodeServer> {
    let command: string
    try {
      command = await this.#subprocess.resolveExecutable(this.#options.command)
    } catch (error) {
      throw new CodeServerError('code_server_not_found', `Cannot find ${this.#options.command}`, {
        cause: error,
      })
    }
    const directories = [
      ...(this.#options.userDataDir === undefined
        ? []
        : ['--user-data-dir', this.#options.userDataDir]),
      ...(this.#options.extensionsDir === undefined
        ? []
        : ['--extensions-dir', this.#options.extensionsDir]),
    ]
    this.#cli = [command, ...directories]
    const version = await this.#run([command, '--version'])
    const commit = /^\S+ ([0-9a-f]{40}) /.exec(version)?.[1]
    if (commit === undefined) {
      throw new CodeServerError(
        'code_server_failed',
        `Unrecognized code-server version: ${version}`,
      )
    }
    // A fresh start installs the extension even when the VSIX is unchanged.
    this.#installed = ''
    await this.syncExtension()
    await rm(this.#socketPath, { force: true })
    // Disposed while the commands above ran: starting now would leave code-server behind.
    if (this.#disposed) throw new CodeServerError('code_server_failed', 'The plugin has stopped')
    const child = this.#subprocess.spawn({
      argv: [
        command,
        ...directories,
        '--socket',
        this.#socketPath,
        '--socket-mode',
        '600',
        '--auth',
        'none',
        '--disable-telemetry',
        '--disable-update-check',
        // Its /proxy/<port> routes would serve any local web server from DSH's origin.
        '--disable-proxy',
      ],
      cwd: homedir(),
      env: this.#options.env,
      graceMs: 5_000,
      stdio: { stdin: 'ignore', stdout: OUTPUT, stderr: OUTPUT },
    })
    this.#child = child
    const running: RunningCodeServer = { socketPath: this.#socketPath, commit }
    const stopped = this.#onStarted(running)
    const exited = (): void => {
      stopped()
      if (this.#child !== child) return
      this.#child = undefined
      this.#starting = undefined
    }
    void child.done.then(exited, exited)
    await waitUntilListening(this.#socketPath, child)
    return running
  }

  async #installExtension(cli: readonly string[]): Promise<void> {
    const { mtimeMs, size } = await stat(this.#extension)
    const stamp = `${mtimeMs}:${size}`
    if (stamp === this.#installed) return
    // Same-version reinstalls are skipped without --force, which would keep a stale build.
    await this.#run([...cli, '--install-extension', this.#extension, '--force'])
    this.#installed = stamp
  }

  /** Run a short code-server CLI command and return its stdout. */
  async #run(argv: readonly string[]): Promise<string> {
    const child = this.#subprocess.spawn({
      argv,
      cwd: homedir(),
      graceMs: 1_000,
      signal: AbortSignal.timeout(120_000),
      stdio: { stdin: 'ignore', stdout: OUTPUT, stderr: OUTPUT },
    })
    const outcome = await child.done
    await child.waitForExit()
    if (outcome.exitCode !== 0) {
      throw new CodeServerError(
        'code_server_failed',
        `${argv.join(' ')} failed: ${output(child, 'stderr')}`,
      )
    }
    return output(child, 'stdout')
  }
}

function output(child: SubprocessHandle, stream: 'stdout' | 'stderr'): string {
  return child.collected[stream]?.readFrom(0).text.trim() ?? ''
}

async function waitUntilListening(socketPath: string, child: SubprocessHandle): Promise<void> {
  let exited = false
  const stop = (): void => {
    exited = true
  }
  void child.done.then(stop, stop)
  for (const deadline = Date.now() + STARTUP_TIMEOUT_MS; Date.now() < deadline; await sleep(100)) {
    if (exited)
      throw new CodeServerError(
        'code_server_failed',
        `code-server exited: ${output(child, 'stderr')}`,
      )
    if (await healthy(socketPath)) return
  }
  child.terminate()
  throw new CodeServerError('code_server_failed', 'code-server did not start within 30 seconds')
}

function healthy(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    get({ socketPath, path: '/healthz' }, (response) => {
      response.resume()
      resolve(response.statusCode === 200)
    }).on('error', () => resolve(false))
  })
}

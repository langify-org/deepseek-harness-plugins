// The tmux server this plugin owns: one socket per DSH home, one tmux session
// per DSH session, named after it. Every call goes through `tmux -S <socket>`,
// so the user's own tmux sessions are never listed or touched.
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseWindows, WINDOW_FORMAT, type TmuxWindow } from '../windows.ts'

const TIMEOUT_MS = 5_000
/** Where the plugin's own terminal-features entry goes, past the defaults and most users' own. */
const LINK_FEATURE_INDEX = 99
const MAX_OUTPUT = 4 * 1024 * 1024

/** A tmux command failed; `missing` when it named a server, session or window that does not exist. */
export class TmuxError extends Error {
  readonly missing: boolean

  constructor(message: string, missing: boolean, options?: ErrorOptions) {
    super(message, options)
    this.missing = missing
  }
}

/** The tmux session that belongs to a DSH session. */
export function sessionName(sessionId: string): string {
  // tmux turns `.` and `:` in names into `_`; DSH ids never contain them.
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) throw new Error(`unexpected session id: ${sessionId}`)
  return `dsh-${sessionId}`
}

/** The DSH session id a tmux session name belongs to, if it is one of ours. */
export function sessionIdOf(name: string): string | undefined {
  return /^dsh-([A-Za-z0-9_-]+)$/.exec(name)?.[1]
}

function exec(file: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { env, timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT },
      (error, stdout, stderr) => {
        if (error === null) return resolve(stdout)
        const message = stderr.trim() || error.message
        // "no server running", "no current target" (no sessions at all), "can't find session/window/pane"
        const missing =
          /no server running|no current target|can't find|no such|error connecting/i.test(message)
        const command = args.find((a) => /^[a-z]+(-[a-z]+)+$/.test(a)) ?? ''
        reject(new TmuxError(`${file} ${command}: ${message}`, missing, { cause: error }))
      },
    )
  })
}

export class Tmux {
  readonly #program: string
  readonly #socket: string
  readonly #env: NodeJS.ProcessEnv

  /**
   * @param program - the tmux executable, a name looked up on PATH or a path.
   * @param socket - the server's socket path.
   * @param env - the environment for tmux and so for every shell it starts.
   */
  constructor(program: string, socket: string, env: NodeJS.ProcessEnv) {
    this.#program = program
    this.#socket = socket
    this.#env = env
  }

  run(args: readonly string[]): Promise<string> {
    return exec(this.#program, ['-S', this.#socket, ...args], this.#env)
  }

  /**
   * Start the server unless it runs, keeping it up while it has no sessions,
   * with links passed on to the tab.
   * Where user systemd is available the server gets its own scope, so it
   * outlives the terminal tabs and DSH itself: DSH stops a terminal by killing
   * everything in its scope. tmux loads the user's configuration itself.
   */
  async start(): Promise<void> {
    const startServer = [
      '-S',
      this.#socket,
      'start-server',
      ';',
      'set-option',
      '-g',
      'exit-empty',
      'off',
      // The tab's terminal (wterm) opens OSC 8 links, which tmux passes on only
      // to terminals with this feature. A fixed index keeps restarts from adding it again.
      ';',
      'set-option',
      '-s',
      `terminal-features[${LINK_FEATURE_INDEX}]`,
      'xterm-256color:hyperlinks',
    ]
    try {
      await exec(
        'systemd-run',
        ['--user', '--scope', '--quiet', '--collect', '--', this.#program, ...startServer],
        this.#env,
      )
    } catch {
      await exec(this.#program, startServer, this.#env)
    }
  }

  /**
   * The command a terminal tab runs: a view of `session` of its own (a grouped
   * session), so each tab shows its own window, ending when the tab detaches.
   * A view starts at the session's first window, or at `window` when given.
   */
  attachCommand(session: string, window?: string): string[] {
    const attach = [this.#program, '-S', this.#socket, 'new-session', '-t', `=${session}`]
    const keep = [';', 'set-option', 'destroy-unattached', 'on']
    if (window === undefined) return [...attach, ...keep]
    const view = `${session}-${randomUUID().slice(0, 8)}`
    return [...attach, '-s', view, ...keep, ';', 'select-window', '-t', `=${view}:${window}`]
  }

  /** Wait until `target` shows any output, such as its shell's prompt, or `ms` passes. */
  async waitForOutput(target: string, ms: number): Promise<void> {
    for (const until = Date.now() + ms; Date.now() < until; await sleep(100)) {
      if ((await this.run(['capture-pane', '-p', '-t', target])).trim() !== '') return
    }
  }

  /**
   * The configuration files this tmux looks for when it starts, existing or
   * not: tmux's own search list for its build, as `#{config_files}` reports it.
   */
  async configFiles(): Promise<string[]> {
    const output = await this.run(['display-message', '-p', '#{config_files}'])
    return output.trim().split(',').filter(Boolean)
  }

  /** Apply the plugin's defaults, for a user without a tmux configuration. */
  async applyDefaults(): Promise<void> {
    const args: string[] = []
    for (const command of DEFAULTS) args.push(...(args.length === 0 ? [] : [';']), ...command)
    await this.run(args)
  }

  /** The session's windows, or none when the session does not exist. */
  async windows(session: string): Promise<TmuxWindow[]> {
    try {
      return parseWindows(
        await this.run(['list-windows', '-t', `=${session}`, '-F', WINDOW_FORMAT]),
      )
    } catch (error) {
      if (error instanceof TmuxError && error.missing) return []
      throw error
    }
  }

  /** Create the session in `cwd`, for a terminal tab or the model's first window, unless it exists. */
  async ensureSession(session: string, sessionId: string, cwd: string): Promise<void> {
    const windows = await this.windows(session)
    if (windows.length > 0) return
    await this.run([
      'new-session',
      '-d',
      '-s',
      session,
      '-c',
      cwd,
      '-e',
      `DSH_SESSION_ID=${sessionId}`,
    ]).catch((error: unknown) => {
      // Created meanwhile, by another tab or the model.
      if (!/duplicate session/i.test(String(error))) throw error
    })
  }

  /** The pane indexes of a window. */
  async panes(window: string): Promise<number[]> {
    const output = await this.run(['list-panes', '-t', window, '-F', '#{pane_index}'])
    return output.split('\n').filter(Boolean).map(Number)
  }

  /** Each of our sessions with the views grouped with it (one per open terminal tab), by session name. */
  async sessions(): Promise<Map<string, string[]>> {
    let output: string
    try {
      output = await this.run(['list-sessions', '-F', '#{session_name}\u001f#{session_group}'])
    } catch (error) {
      if (error instanceof TmuxError && error.missing) return new Map()
      throw error
    }
    const groups = new Map<string, string[]>()
    for (const line of output.split('\n')) {
      const [name = '', group = ''] = line.split('\u001f')
      const base = group === '' ? name : group
      if (name === '' || sessionIdOf(base) === undefined) continue
      groups.set(base, [...(groups.get(base) ?? []), name])
    }
    return groups
  }

  /** Kill sessions; their windows and the programs in them end. */
  async kill(names: readonly string[]): Promise<void> {
    for (const name of names) {
      await this.run(['kill-session', '-t', `=${name}`]).catch((error: unknown) => {
        if (!(error instanceof TmuxError && error.missing)) throw error
      })
    }
  }
}

/**
 * The defaults for a user without a tmux configuration: mouse support, which
 * the terminal tab's scrolling and clicking a window to switch to it need,
 * and a status line at the top whose window list works as tabs.
 */
export const DEFAULTS: readonly (readonly string[])[] = [
  ['set-option', '-g', 'mouse', 'on'],
  ['set-option', '-g', 'status-position', 'top'],
  ['set-option', '-g', 'status-style', 'bg=default,fg=default'],
  ['set-option', '-g', 'status-left', ''],
  ['set-option', '-g', 'status-right', ''],
]

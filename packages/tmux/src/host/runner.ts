// The service other plugins may use to run a command in a conversation's tmux
// session, found with ctx.get(SERVICE) while this plugin runs: a new window
// runs the command, and the next tmux tab to attach for that conversation
// shows it. Nothing imports this module: a caller declares the shape itself.
import { sessionName, type Tmux } from './tmux.ts'

export const SERVICE = 'langifyTmux'

export interface TmuxRunner {
  /** Run `line` in a new window of the conversation's tmux session, in `cwd`; resolves to the tab kind to open. */
  run(task: { sessionId: string; cwd: string; line: string }): Promise<{ tab: string }>
}

/** How long a new window waits for the tab that is to show it. */
const FOCUS_MS = 10_000
/** How long the new window's shell gets to print its prompt before the line is typed. */
const PROMPT_MS = 3_000
const MAX_LINE = 4_096

/** The window the next tab of a conversation shows, for a short while. */
export class Focus {
  readonly #windows = new Map<string, { window: string; until: number }>()

  set(sessionId: string, window: string): void {
    this.#windows.set(sessionId, { window, until: Date.now() + FOCUS_MS })
  }

  take(sessionId: string): string | undefined {
    const focus = this.#windows.get(sessionId)
    this.#windows.delete(sessionId)
    return focus !== undefined && focus.until >= Date.now() ? focus.window : undefined
  }
}

/** Whether `line` is one line a shell can take as typed: no control characters. */
export function isCommandLine(line: string): boolean {
  if (line.trim() === '' || line.length > MAX_LINE) return false
  for (const char of line) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

export function tmuxRunner(tmux: Tmux, focus: Focus, tab: string): TmuxRunner {
  return {
    async run({ sessionId, cwd, line }) {
      if (!isCommandLine(line))
        throw new Error('the command must be one line without control characters')
      const session = sessionName(sessionId)
      await tmux.ensureSession(session, sessionId, cwd)
      const window = (
        await tmux.run([
          'new-window',
          '-d',
          '-t',
          `=${session}:`,
          '-n',
          line.slice(0, 40),
          '-c',
          cwd,
          '-P',
          '-F',
          '#{window_id}',
        ])
      ).trim()
      // Typed before the shell's prompt, the line would show twice.
      await tmux.waitForOutput(window, PROMPT_MS)
      await tmux.run(['send-keys', '-t', window, '-l', '--', line])
      await tmux.run(['send-keys', '-t', window, 'Enter'])
      focus.set(sessionId, window)
      return { tab }
    },
  }
}

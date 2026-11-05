// What the plugin reads from tmux about a session's windows, and how it shows
// them to the model. Pure: the host half runs tmux and passes its output here.

/** One tmux window of a DSH session's tmux session. */
export interface TmuxWindow {
  /** tmux's stable id (`@3`), unchanged by renames and renumbering. */
  readonly id: string
  readonly name: string
  /** The foreground program of the window's active pane: the shell at a prompt. */
  readonly command: string
  readonly path: string
}

const FIELDS = ['#{window_id}', '#{window_name}', '#{pane_current_command}', '#{pane_current_path}']
// tmux rejects control characters in window names, so the unit separator cannot occur in them.
const SEPARATOR = '\u001f'

/** The `list-windows -F` format that `parseWindows` reads. */
export const WINDOW_FORMAT: string = FIELDS.join(SEPARATOR)

/** Parse `list-windows -F WINDOW_FORMAT` output; lines that do not fit are skipped. */
export function parseWindows(output: string): TmuxWindow[] {
  const windows: TmuxWindow[] = []
  for (const line of output.split('\n')) {
    const fields = line.split(SEPARATOR)
    if (fields.length !== FIELDS.length) continue
    const [id = '', name = '', command = '', path = ''] = fields
    if (!/^@\d+$/.test(id)) continue
    windows.push({ id, name, command, path })
  }
  return windows
}

const SHELLS = new Set([
  'bash',
  'zsh',
  'fish',
  'sh',
  'dash',
  'ksh',
  'mksh',
  'tcsh',
  'csh',
  'nu',
  'elvish',
  'xonsh',
  'pwsh',
])

/** Whether the window's shell is at its prompt rather than running a program. */
export function atPrompt(window: TmuxWindow): boolean {
  // A login shell reports itself as `-bash`.
  return SHELLS.has(window.command.replace(/^-/, ''))
}

/** `path` with the home directory written as `~`. */
export function shortPath(path: string, home: string): string {
  if (home === '' || home === '/') return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** `value` escaped for an XML attribute in double quotes. */
export function xmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\n', '&#10;')
}

/** What the model is told when the conversation's tmux session is gone after it saw windows. */
export const CLOSED: string =
  '<tmux>No windows: the tmux session is closed. tmux_session new-window opens a new one.</tmux>'

/**
 * What the model sees at the start of a turn: one element per window, with
 * its id, name, folder and running command, never screen contents. `undefined` without windows.
 */
export function digest(windows: readonly TmuxWindow[], home: string): string | undefined {
  if (windows.length === 0) return undefined
  const lines = windows.map((w) => {
    const attributes = [
      `id="${xmlAttribute(w.id)}"`,
      `name="${xmlAttribute(w.name)}"`,
      `path="${xmlAttribute(shortPath(w.path, home))}"`,
      `command="${xmlAttribute(w.command)}"`,
    ]
    return `<window ${attributes.join(' ')}/>`
  })
  return ['<tmux>', ...lines, '</tmux>'].join('\n')
}

/**
 * What every conversation's model knows from its system prompt: the shared
 * terminal, the tools, and the `<tmux>` notes it gets at the start of a turn.
 */
export const GUIDE: string = `# Shared terminal (tmux)

Each conversation has its own tmux session, shown in the terminal of DSH's right sidebar, where the user also works. When its windows change, you get a <tmux> note at the start of a turn: one <window> per window, with its id, name, folder (path) and running command. An empty <tmux> means the session is closed. Without any note, no session exists yet.

Use the tmux_window and tmux_session tools, aiming at windows by id (such as @3); ids do not change while the tmux server runs, unlike window numbers and names. Do not change tmux settings unless asked.`

/** Commands that start a shell, which should start in the conversation's folder. */
const OPENS_SHELL = new Set(['new-window', 'split-window', 'neww', 'splitw'])
/** Commands whose -a reaches every session on the server. */
const LISTS = new Set(['list-windows', 'list-panes', 'lsw', 'lsp'])

/**
 * The tmux arguments for one command of the model's, aimed at `target`: a
 * window or pane the plugin checked, or the conversation's session. `-t` goes
 * right after the command name, where tmux reads flags; the model cannot give
 * its own, so it cannot reach outside the conversation. A command that opens
 * a shell also gets `-c cwd`, the conversation's folder, unless it has one,
 * and `new-window` prints the new window's id. `-a` on the list commands,
 * which would list every session's windows, is refused.
 */
export function tmuxCommand(
  target: string,
  command: string,
  args: readonly string[],
  cwd: string,
): string[] {
  if (!/^[a-z]+(-[a-z]+)*$/.test(command))
    throw new Error(`"${command}" is not a tmux command name`)
  if (args.includes('-t')) {
    throw new Error("Do not pass -t: aim at a window and pane with the tool's own parameters.")
  }
  const given = args.filter((a) => /^-[A-Za-z]+$/.test(a))
  if (LISTS.has(command) && given.some((f) => f.includes('a'))) {
    throw new Error(`Do not pass -a to ${command}: it lists every conversation's windows.`)
  }
  const flags = ['-t', target]
  if (OPENS_SHELL.has(command) && !args.includes('-c')) flags.push('-c', cwd)
  if ((command === 'new-window' || command === 'neww') && !args.includes('-P')) {
    flags.push('-P', '-F', '#{window_id}')
  }
  return [command, ...flags, ...args]
}

const READ_ONLY = new Set(['capture-pane', 'list-windows', 'list-panes', 'show-options'])

/**
 * Whether a command only reads, so it needs no permission: one of a few
 * reading commands, with no `#(` (a format that runs a shell command), no
 * argument ending in `;` (which tmux reads as the start of another command),
 * and for capture-pane printing (`-p`) rather than filling a paste buffer.
 */
export function readsOnly(command: string, args: readonly string[]): boolean {
  if (!READ_ONLY.has(command)) return false
  if (args.some((a) => a.includes('#(') || a.endsWith(';'))) return false
  if (command !== 'capture-pane') return true
  const flags = args.filter((a) => /^-[A-Za-z]+$/.test(a))
  return flags.some((f) => f.includes('p')) && !flags.some((f) => f.includes('b'))
}

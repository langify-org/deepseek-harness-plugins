// What the terminal's program asked of the mouse, read from its output, and the
// wheel reports a swipe turns into. Pure: the browser half feeds it output.

/** Set or reset private modes: `ESC [ ? 1000 ; 1006 h`. */
const MODE = new RegExp(String.raw`${'\u001b'}\[\?([\d;]+)([hl])`, 'g')

/** The mouse modes the program turned on, as xterm numbers them. */
export class MouseModes {
  readonly #on = new Set<string>()

  /** Note the mode changes in a chunk of output. */
  // ponytail: a sequence split across two chunks is missed, rare with tmux's whole-screen writes; buffer the tail if it shows.
  read(output: string): void {
    for (const [, modes = '', set] of output.matchAll(MODE)) {
      for (const mode of modes.split(';')) {
        if (set === 'h') this.#on.add(mode)
        else this.#on.delete(mode)
      }
    }
  }

  /** Whether the program takes mouse reports, in the SGR form `wheel` writes. */
  get reports(): boolean {
    return this.#on.has('1006') && ['1000', '1002', '1003'].some((mode) => this.#on.has(mode))
  }
}

/** One wheel step at a cell, 1-based, in SGR form. */
export function wheel(up: boolean, col: number, row: number): string {
  return `\u001b[<${up ? 64 : 65};${col};${row}M`
}

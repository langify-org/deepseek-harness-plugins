// tmux's copies, read from its output. When it copies (copy mode, or a mouse
// selection), tmux asks the outer terminal to set the clipboard with OSC 52:
// ESC ] 52 ; <selection> ; <base64> BEL (or ESC \). Pure: the browser half
// feeds it output and writes what it returns to the clipboard.

const START = '\u001b]52;'
const TERMINATORS = ['\u0007', '\u001b\\']
/** An unterminated sequence longer than this is dropped rather than held. */
const MAX_PENDING = 1 << 20

/** Reads the clipboard writes in terminal output, across chunk boundaries. */
export class ClipboardWrites {
  #pending = ''

  /** The texts this chunk of output asks to copy, in order. Queries and clears are ignored. */
  read(output: string): string[] {
    let text = this.#pending + output
    this.#pending = ''
    const copied: string[] = []
    for (;;) {
      const start = text.indexOf(START)
      if (start === -1) break
      const body = text.slice(start + START.length)
      const end = terminator(body)
      if (end === undefined) {
        // The rest of the sequence comes with the next chunk.
        if (text.length - start <= MAX_PENDING) this.#pending = text.slice(start)
        return copied
      }
      const data = body.slice(0, end.index).split(';')[1]
      const value = data === undefined || data === '' || data === '?' ? undefined : decode(data)
      if (value !== undefined) copied.push(value)
      text = body.slice(end.index + end.length)
    }
    // A chunk may end in the first bytes of a sequence.
    for (let length = START.length - 1; length > 0; length--) {
      if (text.endsWith(START.slice(0, length))) {
        this.#pending = START.slice(0, length)
        break
      }
    }
    return copied
  }
}

function terminator(body: string): { index: number; length: number } | undefined {
  let found: { index: number; length: number } | undefined
  for (const mark of TERMINATORS) {
    const index = body.indexOf(mark)
    if (index !== -1 && (found === undefined || index < found.index)) {
      found = { index, length: mark.length }
    }
  }
  return found
}

/** UTF-8 text from base64; `undefined` when it is not valid base64. */
function decode(data: string): string | undefined {
  try {
    const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return undefined
  }
}

/** Discord's content limit per message. */
export const MESSAGE_LIMIT = 2000

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

/**
 * Split text into Discord messages of at most `limit` characters. Cuts at the
 * last line break that fits, or mid-line when one line is too long. A code
 * block cut in two is closed at the end of one part and reopened, with its
 * language, at the start of the next.
 */
export function splitMessage(text: string, limit: number = MESSAGE_LIMIT): string[] {
  const parts: string[] = []
  let current = ''
  // The fence line that opened the code block `current` ends inside, if any.
  let open: string | undefined

  const flush = (): void => {
    if (current.trim() === '') return
    const close = open === undefined ? '' : `\n${fenceOf(open)}`
    parts.push(current + close)
    current = open === undefined ? '' : `${open}\n`
  }
  const room = (): number => limit - (open === undefined ? 0 : fenceOf(open).length + 1)

  for (const line of text.split('\n')) {
    let rest = line
    for (;;) {
      const sep = current === '' || current.endsWith('\n') ? '' : '\n'
      if (current.length + sep.length + rest.length <= room()) {
        current += sep + rest
        break
      }
      const fresh = open === undefined ? 0 : open.length + 1
      if (current.length > fresh) {
        flush()
        continue
      }
      // A single line longer than a whole message: cut it.
      const take = room() - current.length
      current += rest.slice(0, take)
      rest = rest.slice(take)
      flush()
    }
    const fence = FENCE.exec(line)
    if (fence !== null) {
      // An absurdly long fence line could never be reopened inside the limit.
      if (open === undefined) open = line.length < limit / 2 ? line.trimStart() : undefined
      else if (fence[1]?.startsWith(fenceOf(open)) === true && fence[2]?.trim() === '')
        open = undefined
    }
  }
  flush()
  return parts
}

function fenceOf(openLine: string): string {
  return /^(`{3,}|~{3,})/.exec(openLine)?.[1] ?? '```'
}

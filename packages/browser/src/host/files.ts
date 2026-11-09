// File names that come from pages and from the user's browser, made safe to
// use as one path segment under the plugin's own directories.

const MAX_BYTES = 200
const encoder = new TextEncoder()

function byteLength(text: string): number {
  return encoder.encode(text).length
}

/**
 * A name that is one path segment: no separators, no control characters, no
 * leading dots, at most 200 UTF-8 bytes with its extension kept, never empty.
 */
export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned =
    name
      .replace(/[/\\]/g, '_')
      .replace(/\p{Cc}/gu, '')
      .trim()
      .replace(/^\.+/, '') || fallback
  if (byteLength(cleaned) <= MAX_BYTES) return cleaned
  const dot = cleaned.lastIndexOf('.')
  const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : ''
  // Cut whole characters, as the user sees them, so no emoji is left in pieces.
  let stem = ''
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(
    cleaned.slice(0, cleaned.length - extension.length),
  )
  for (const { segment } of segments) {
    if (byteLength(stem + segment + extension) > MAX_BYTES) break
    stem += segment
  }
  return stem + extension
}

/** `name`, or `name (2)`, `name (3)`… before the extension: the first that `taken` does not hold. */
export function uniqueFileName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, '']
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${extension}`
    if (!taken.has(candidate)) return candidate
  }
}

/** A Content-Disposition value that downloads `name`, with an ASCII fallback (RFC 6266). */
export function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  // RFC 5987's attr-char leaves out ' ( ) *, which encodeURIComponent keeps.
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

// Which lines of the notes are about what a text is about: a rough measure by the
// words the two share, so that the model can be asked about a few lines rather
// than be left to notice them among all of them. A question put to a model is
// answered; lines that merely sit in its context are not compared.
//
// The measure is BM25 over words: runs of Latin letters and digits as they are,
// and pairs of neighbouring characters of everything else, so that Japanese and
// Chinese need no dictionary.
//
// Shared words do not find everything. What is known about a tool is needed when
// the tool is named, whatever is being asked about it: "can I send 320 mails
// through postbox" shares no word with "postbox drops what is over 200 a day".
// So a name that few lines of the notes have brings all of those lines: the
// name is the cue, as when a model searches the notes for it.

/** One line of a note. */
export interface NoteLine {
  readonly file: string
  /** The line's number in its file, from 1. */
  readonly line: number
  readonly text: string
}

/** The words of `text` as the measure counts them. */
export function words(text: string): string[] {
  const found: string[] = []
  for (const run of text.toLowerCase().match(/[a-z0-9_]+|[^\sa-z0-9_\p{P}\p{S}]+/gu) ?? []) {
    if (/^[a-z0-9_]/.test(run)) {
      if (run.length > 1) found.push(run)
    } else if (run.length === 1) {
      found.push(run)
    } else {
      for (let at = 0; at < run.length - 1; at++) found.push(run.slice(at, at + 2))
    }
  }
  return found
}

/** The lines of `files` that say something: not blank, not a heading, not a table's rule. */
export function noteLines(files: Readonly<Record<string, string>>): NoteLine[] {
  const lines: NoteLine[] = []
  for (const [file, text] of Object.entries(files)) {
    for (const [index, raw] of text.split('\n').entries()) {
      const line = raw.trim()
      if (line.length < 12 || line.startsWith('#') || /^[|\-: ]+$/.test(line)) continue
      lines.push({ file, line: index + 1, text: line })
    }
  }
  return lines
}

/**
 * The names in `text`: words in Latin letters, and runs of katakana, of three
 * characters or more, in lower case. In notes that are not written in a Latin
 * script, these are mostly what things are called.
 */
export function names(text: string): string[] {
  const found = text.match(/[A-Za-z][A-Za-z0-9_.-]{2,}|[ァ-ヶー]{3,}/gu) ?? []
  return [...new Set(found.map((name) => name.toLowerCase().replace(/[.-]+$/, '')))]
}

/** What `recall` looks for: how many lines, and what makes a name rare. */
export interface RecallLimits {
  /** At most this many lines in all. */
  readonly lines: number
  /** A name that at most this many lines have brings all of them. */
  readonly rare: number
  /** At most this many of the lines found by shared words, and of those from one file. */
  readonly shared: number
  readonly perFile: number
  /** How much a line found by shared words has to be about what was said. */
  readonly floor: number
}

/**
 * The lines to put beside what was just said: every line that has a rare name
 * from it, the rarest name's first while there is room, and the lines that
 * share the most words with it. They are given in the order of how many words
 * they share, the most first.
 */
export function recall(said: string, lines: readonly NoteLine[], limits: RecallLimits): NoteLine[] {
  const lower = lines.map((line) => line.text.toLowerCase())
  const rare = names(said)
    .map((name) => ({
      name,
      at: lower.flatMap((text, index) => (text.includes(name) ? [index] : [])),
    }))
    .filter(({ at }) => at.length > 0 && at.length <= limits.rare)
    // The rarest first; of equally rare ones, a name in Latin letters before a common word in katakana.
    .toSorted(
      (a, b) =>
        a.at.length - b.at.length ||
        Number(/^[ァ-ヶー]/u.test(a.name)) - Number(/^[ァ-ヶー]/u.test(b.name)),
    )
  const found = new Set<number>()
  for (const { at } of rare) {
    for (const index of at) {
      if (found.size < limits.lines) found.add(index)
    }
  }
  const indexOf = new Map(lines.map((line, index) => [line, index]))
  let shared = 0
  for (const { line, score } of scored(said, lines, limits.shared + found.size, limits.perFile)) {
    const index = indexOf.get(line)
    if (index === undefined || score < limits.floor || found.has(index)) continue
    if (found.size >= limits.lines || shared >= limits.shared) break
    found.add(index)
    shared++
  }
  const all = scored(said, lines, lines.length, lines.length)
  const order = new Map(all.map(({ line }, position) => [line, position]))
  return [...found]
    .map((index) => lines[index])
    .filter((line) => line !== undefined)
    .toSorted((a, b) => (order.get(a) ?? lines.length) - (order.get(b) ?? lines.length))
}

/**
 * The lines that name the day `date` ("2026-11-16"), as people write it: 2026-11-16,
 * 11/16, 11 月 16 日, with or without leading zeros. A promise for a day is
 * remembered on that day by the date, not by what it is about.
 */
export function naming(date: string, lines: readonly NoteLine[]): NoteLine[] {
  const [year, month, day] = date.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) return []
  const named = new RegExp(
    `(?<![\\d/-])(?:${year}[-/])?0?${month}[-/]0?${day}(?![\\d/-])|(?<!\\d)0?${month}\\s*月\\s*0?${day}\\s*日`,
    'u',
  )
  return lines.filter((line) => named.test(line.text))
}

/**
 * The `count` lines most about what `query` is about, best first, at most
 * `perFile` of them from one file: the lines of the file a topic has are found
 * anyway, and what is wanted is what the other files say.
 */
export function related(
  query: string,
  lines: readonly NoteLine[],
  count: number,
  perFile: number,
): NoteLine[] {
  return scored(query, lines, count, perFile).map(({ line }) => line)
}

/** The same, with each line's score: higher is more about the same thing; only comparable within one call. */
export function scored(
  query: string,
  lines: readonly NoteLine[],
  count: number,
  perFile: number,
): { line: NoteLine; score: number }[] {
  const documents = lines.map((line) => words(line.text))
  const mean = documents.reduce((sum, document) => sum + document.length, 0) / (lines.length || 1)
  const containing = new Map<string, number>()
  for (const document of documents) {
    for (const word of new Set(document)) containing.set(word, (containing.get(word) ?? 0) + 1)
  }
  const asked = new Set(words(query))
  const scores = documents.map((document, index) => {
    const counts = new Map<string, number>()
    for (const word of document) {
      if (asked.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1)
    }
    let score = 0
    for (const [word, times] of counts) {
      const rarity = Math.log(
        1 +
          (lines.length - (containing.get(word) ?? 0) + 0.5) / ((containing.get(word) ?? 0) + 0.5),
      )
      score += (rarity * times * 2.5) / (times + 1.5 * (0.25 + (0.75 * document.length) / mean))
    }
    return { index, score }
  })
  const best: { line: NoteLine; score: number }[] = []
  const taken = new Map<string, number>()
  for (const { index, score } of scores.toSorted((a, b) => b.score - a.score)) {
    const line = lines[index]
    if (score <= 0 || line === undefined || best.length >= count) break
    const from = taken.get(line.file) ?? 0
    if (from >= perFile) continue
    taken.set(line.file, from + 1)
    best.push({ line, score })
  }
  return best
}

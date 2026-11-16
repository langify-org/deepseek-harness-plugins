// Hunches: what earlier conversations taught about how to act in a kind of
// moment, and what brings one up when its moment comes again.
//
// How to act is learned in a moment and holds in moments like it, not
// everywhere: "show one small next step" was learned when the user froze before
// a bank transfer, and read as a rule for every reply it closed a conversation
// in which the user wanted to think aloud. So the nightly tidy keeps such things
// in hunches/, a file for each kind of moment, with the cues by which the moment
// can be told as it happens, what happened in it, the user's own words, and a
// reason. A conversation is not given them to read. A small model watches it
// from outside instead, and before a step, when what just happened is one of
// those moments, names the hunch; the conversation is given the hunch as the
// night wrote it, the user's words and all: a recollection, not an instruction,
// for the conversation's model to weigh. The watcher only tells the moment: in
// its own words a recollection turned into advice, and a retelling loses what
// the original says. A watcher that is not sure says nothing, since one that
// speaks out of turn is soon not listened to.

/** The directory, in the memory directory, of the hunches. */
export const HUNCHES = 'hunches'

/** The file, in the memory directory, of what memory cannot settle without the user. */
export const QUESTIONS_FILE = 'questions.md'

/** The watcher's whole reply when nothing is called up. */
export const QUIET = '(nothing)'

/** One hunch: its file in the memory directory, and what the file says. */
export interface Hunch {
  readonly file: string
  readonly text: string
}

/** The hunches among the files of the memory directory, by file name. */
export function hunchesOf(files: Readonly<Record<string, string>>): Hunch[] {
  return Object.entries(files)
    .filter(([file, text]) => file.startsWith(`${HUNCHES}/`) && text.trim() !== '')
    .map(([file, text]) => ({ file, text: text.trim() }))
    .toSorted((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
}

/**
 * The watcher's system prompt: what it does, then every hunch. The hunches
 * change once a day, so the rest of the day the prompt is read from the cache.
 */
export function watcherSystem(hunches: readonly Hunch[]): string {
  return [
    'You watch a conversation between a user and an AI assistant from outside, as its memory: you bring things up on your own when the moment calls for them. You take no part in the conversation, and what you say reaches only the assistant.',
    '',
    "Below are the hunches memory holds: what earlier conversations taught about a kind of moment. Each names the cues by which such a moment can be told as it happens, what happened in it before, the user's own words, and why it may matter.",
    '',
    'You are shown what was happening in the conversation, then what just happened. When what just happened is one of the moments a hunch is about, its cues there in what the user says or does, in what the assistant just did or is setting out to do, or in what a tool showed, bring the hunch up. A moment can show over several turns: what the assistant offered and whether the user took it up, how the user answers. To bring a hunch up, reply with its file, exactly as it is named after === below, such as hunches/example.md, one to a line, and nothing else: the assistant is given the hunch itself and decides whether it fits.',
    '',
    `Judge by the moment, not by shared words: a hunch whose words appear but whose moment this is not is not called up, and one whose moment this is may share no word with what was said. Most moments call up nothing. A hunch brought up where it does not fit costs the assistant its attention, and a memory that speaks out of turn is soon not listened to. Bring up at most two. Naming a hunch brings it up, so do not name one to say that it does not fit. When nothing is called up, reply with exactly ${QUIET}.`,
    '',
    ...hunches.flatMap(({ file, text }) => [`=== ${file} ===`, text, '']),
  ].join('\n')
}

/**
 * The watcher's message: what was happening, what just happened, and the
 * hunches it brought up in this conversation before, which the conversation
 * already has.
 */
export function watcherRequest(
  before: string,
  now: string,
  broughtUpBefore: readonly string[],
): string {
  return [
    'What was happening:',
    before === '' ? '(Nothing before this.)' : before,
    '',
    'What just happened:',
    now,
    ...(broughtUpBefore.length === 0
      ? []
      : [
          '',
          `Brought up in this conversation before, so not to be brought up again: ${broughtUpBefore.join(', ')}`,
        ]),
  ].join('\n')
}

/**
 * The hunches the watcher brought up: none when it named none it was given. A
 * small model asked to name a file often shortens it, so a hunch is also named
 * by its file's name alone, with the extension, or on a line of its own or in
 * parentheses without it.
 */
export function broughtUp(reply: string, hunches: readonly Hunch[]): Hunch[] {
  const text = reply.trim()
  if (text === '' || text === QUIET) return []
  return hunches.filter(({ file }) => {
    const name = file.slice(HUNCHES.length + 1).replace(/\.md$/, '')
    const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return (
      text.includes(file) ||
      text.includes(`${name}.md`) ||
      new RegExp(`^\\s*${escaped}\\s*$|[(（[]\\s*${escaped}\\s*[)）\\]]`, 'mu').test(text)
    )
  })
}

/** What a conversation is given of the hunches the watcher brought up: each as the night wrote it. */
export function hunchText(hunches: readonly Hunch[]): string {
  return [
    '<memory-hunch>',
    'Your memory brought this up at this point: what earlier conversations taught about a moment like this one, as it was written down then. It says what happened then, not what to do now: weigh it, and leave it where it does not fit.',
    ...hunches.flatMap(({ file, text }) => ['', `=== ${file} ===`, text]),
    '</memory-hunch>',
  ].join('\n')
}

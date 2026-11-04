// The command line a recipe's form types into the terminal. The line goes to an
// interactive shell, so every value is quoted and control characters, which the
// terminal would act on even inside quotes, are refused.
import type { Recipe } from './rpc.ts'

/** Form values by parameter name: text for values, `true` for a set flag. */
export type Values = Readonly<Record<string, string | boolean | undefined>>

export type Built =
  | { readonly ok: true; readonly line: string }
  | { readonly ok: false; readonly reason: 'missing' | 'control'; readonly parameter: string }

/** Quote `value` as one word for a POSIX shell. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

// C0 controls and DEL: Ctrl-C, Ctrl-U, Enter and the like edit or end the line.
// oxlint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/

/** Words the shell reads literally, left unquoted for a readable command. */
const PLAIN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$|^--?[A-Za-z0-9][A-Za-z0-9_-]*$/

/** The `just` command line for `recipe` with the form's `values`, without the trailing Enter. */
export function buildCommand(recipe: Recipe, values: Values): Built {
  if (CONTROL.test(recipe.name)) return { ok: false, reason: 'control', parameter: recipe.name }
  for (const p of recipe.parameters) {
    const value = values[p.name]
    if (typeof value === 'string' && CONTROL.test(value)) {
      return { ok: false, reason: 'control', parameter: p.name }
    }
  }
  const words = ['just', recipe.name]
  const positional: string[] = []
  const rest: string[] = []
  const singulars = recipe.parameters.filter((p) => p.option === null && p.kind === 'singular')
  const text = (name: string): string => {
    const value = values[name]
    return typeof value === 'string' ? value : ''
  }

  for (const p of recipe.parameters) {
    if (p.option !== null) {
      if (p.flag) {
        if (values[p.name] === true) words.push(p.option)
      } else if (text(p.name) !== '') words.push(p.option, text(p.name))
      else if (!p.optional) return missing(p.name)
    } else if (p.kind !== 'singular') {
      rest.push(...text(p.name).split(/\s+/).filter(Boolean))
      if (p.kind === 'plus' && rest.length === 0) return missing(p.name)
    }
  }

  // Positional values fill from the left: an empty one may be left out only
  // when nothing after it is given, so `just` uses its default.
  const given = singulars.map((p) => text(p.name))
  const last = rest.length > 0 ? given.length - 1 : given.findLastIndex((v) => v !== '')
  for (const [index, p] of singulars.entries()) {
    const value = given[index] ?? ''
    if (index > last) {
      if (!p.optional) return missing(p.name)
      continue
    }
    if (value === '') return missing(p.name)
    positional.push(value)
  }

  const all = [...words, ...positional, ...rest]
  return {
    ok: true,
    line: all.map((word) => (PLAIN.test(word) ? word : shellQuote(word))).join(' '),
  }
}

function missing(parameter: string): Built {
  return { ok: false, reason: 'missing', parameter }
}

// How the Tasks tab writes a recipe's parameters and where its justfile is.
import type { Parameter } from './rpc.ts'

/** One parameter in `just`'s own notation: `target`, `mode=debug`, `[--verbose]`, `*rest`. */
export function parameterLabel(p: Parameter): string {
  const name = p.option ?? p.name
  if (p.flag) return `[${name}]`
  if (p.kind === 'star') return `*${name}`
  if (p.kind === 'plus') return `+${name}`
  if (p.default !== null) return `${name}=${p.default}`
  return p.optional ? `[${name}]` : name
}

/**
 * The justfile relative to `cwd` when it is in a folder above it, such as
 * `../justfile`; `undefined` when it is in `cwd` itself. `just` only looks
 * upward, so any other place is shown as the full path.
 */
export function justfileLabel(cwd: string, justfile: string): string | undefined {
  const slash = justfile.lastIndexOf('/')
  const dir = justfile.slice(0, slash)
  const name = justfile.slice(slash + 1)
  if (dir === cwd) return undefined
  if (!cwd.startsWith(`${dir}/`)) return justfile
  const depth = cwd.slice(dir.length + 1).split('/').length
  return `${'../'.repeat(depth)}${name}`
}

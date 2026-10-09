/**
 * Project hooks: a project's own `.dsh/hooks.yml`, run only for projects under
 * a directory the user trusts in the plugin config.
 *
 * The file is read again for every event, so editing it takes effect at once.
 */
import { lstat, readFile, realpath } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { load } from 'js-yaml'
import { parseHookLists, type HookLists, type ProjectHooksConfig } from './config.ts'

export type ProjectHooks =
  /** No hooks file, or project hooks are off. */
  | { readonly kind: 'none' }
  /** A hooks file exists, but its project is not under a trusted directory. */
  | { readonly kind: 'untrusted'; readonly root: string; readonly file: string }
  /** The hooks file could not be read or is not valid. */
  | { readonly kind: 'invalid'; readonly root: string; readonly file: string; readonly problem: string }
  | { readonly kind: 'ok'; readonly root: string; readonly file: string; readonly hooks: HookLists }

/**
 * The project a directory belongs to: the nearest ancestor (or itself) that is
 * a git working tree. Outside git, the directory itself.
 */
export async function projectRoot(dir: string): Promise<string> {
  let current = dir
  for (;;) {
    if (await isGitWorkingTree(current)) return current
    const parent = dirname(current)
    if (parent === current) return dir
    current = parent
  }
}

/**
 * Whether `dir` has a `.git` the way git itself recognizes it: a file (linked
 * worktrees and submodules) or a directory with a `HEAD`. A stray empty `.git`
 * directory does not count.
 */
async function isGitWorkingTree(dir: string): Promise<boolean> {
  try {
    const entry = await lstat(join(dir, '.git'))
    if (entry.isFile()) return true
    return entry.isDirectory() && (await exists(join(dir, '.git', 'HEAD')))
  } catch {
    return false
  }
}

/** Whether `root` is one of `trustedDirs` or inside one, comparing real paths. */
export async function isTrusted(root: string, trustedDirs: readonly string[]): Promise<boolean> {
  const real = await realpath(root).catch(() => undefined)
  if (real === undefined) return false
  for (const dir of trustedDirs) {
    const trusted = await realpath(dir).catch(() => undefined)
    if (trusted === undefined) continue
    if (real === trusted || real.startsWith(trusted.endsWith(sep) ? trusted : `${trusted}${sep}`)) return true
  }
  return false
}

/**
 * Find and read the hooks file of the project `dir` belongs to.
 * An untrusted project's file is never read.
 */
export async function loadProjectHooks(dir: string, config: ProjectHooksConfig): Promise<ProjectHooks> {
  if (config.trustedDirs.length === 0) return { kind: 'none' }
  const root = await projectRoot(dir)
  const file = join(root, config.file)
  if (!(await exists(file))) return { kind: 'none' }
  if (!(await isTrusted(root, config.trustedDirs))) return { kind: 'untrusted', root, file }
  try {
    const text = await readFile(file, 'utf8')
    return { kind: 'ok', root, file, hooks: parseHookLists(load(text, { filename: file }), file) }
  } catch (error) {
    return { kind: 'invalid', root, file, problem: error instanceof Error ? error.message : String(error) }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** Workbench names, branch names, and where workbenches live. */
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/

/**
 * Validate a workbench name: it becomes a directory name and part of a git
 * branch name, so it is kept to letters, digits, `.`, `_`, and `-`.
 * @returns the reason it is invalid, or `undefined` when it is valid.
 */
export function nameProblem(name: unknown): string | undefined {
  if (typeof name !== 'string' || name === '') return 'a name is required'
  if (!NAME.test(name)) return 'use 1 to 63 letters, digits, ".", "_", or "-", starting with a letter or digit'
  if (name.includes('..') || name.endsWith('.') || name.endsWith('.lock')) return 'the name cannot contain "..", or end with "." or ".lock"'
  return undefined
}

/** `${XDG_DATA_HOME:-~/.local/share}/dsh-workbench`. */
export function defaultRoot(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== '' ? env.XDG_DATA_HOME : join(homedir(), '.local', 'share')
  return join(dataHome, 'dsh-workbench')
}

/** `<root>/<parent directory name>/<name>`. */
export function workbenchDir(root: string, parentPath: string, name: string): string {
  return join(root, basename(parentPath) || 'root', name)
}

/** The Workspace title: `<parent title>/<name>`, shown right after the parent. */
export function workbenchTitle(parentTitle: string, name: string): string {
  return `${parentTitle}/${name}`
}

export function branchName(prefix: string, name: string): string {
  return `${prefix}${name}`
}

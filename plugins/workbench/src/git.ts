/** Run git without a shell, with a timeout. */
import { execFile } from 'node:child_process'

export interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export function git(cwd: string, args: readonly string[], timeoutMs = 120_000): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile('git', [...args], { cwd, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1
      resolve({ code, stdout: String(stdout), stderr: error !== null && stderr === '' ? error.message : String(stderr) })
    })
  })
}

/** Run git and throw with its stderr when it fails. */
export async function gitOrThrow(cwd: string, args: readonly string[]): Promise<string> {
  const result = await git(cwd, args)
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || `exit ${result.code}`}`)
  return result.stdout
}

/** The top level of the git working tree `dir` belongs to, or `undefined` outside git. */
export async function gitTopLevel(dir: string): Promise<string | undefined> {
  const result = await git(dir, ['rev-parse', '--show-toplevel'])
  return result.code === 0 ? result.stdout.trim() : undefined
}

/** Number of `git status --porcelain` lines, or `null` when git cannot tell. */
export async function changeCount(dir: string): Promise<number | null> {
  const result = await git(dir, ['status', '--porcelain'])
  if (result.code !== 0) return null
  return result.stdout.split('\n').filter((line) => line.trim() !== '').length
}

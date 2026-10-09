import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

/** A fresh temporary directory, removed after the test file finishes. */
export async function tempDir(prefix = 'dsh-session-hooks-'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** Poll until `check` returns a value other than `undefined`. */
export async function waitFor<T>(check: () => T | undefined | Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Shell-quote one argument. */
export function sh(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

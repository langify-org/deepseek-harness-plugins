// Chromium on the display, with one profile for every conversation, so logins
// are shared. It opens no window of its own: each Browser tab gets one, made
// over CDP. Chromium picks its DevTools port, on 127.0.0.1 only, and names it
// in the profile's DevToolsActivePort file.
import { mkdir, readFile, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { stderrOf } from './display.ts'
import { ProgramMissing } from './errors.ts'

export interface ChromiumOptions {
  readonly command: string
  /** Added after the plugin's own flags. */
  readonly flags: readonly string[]
  /** LANGUAGE for Chromium's own interface; empty keeps the inherited one. */
  readonly language: string
  readonly profileDir: string
}

export interface RunningChromium {
  readonly process: SubprocessHandle
  /** The browser's DevTools WebSocket. */
  readonly url: string
}

const STARTUP_TIMEOUT_MS = 30_000
const STDERR = { maxBytes: 64 * 1024 }

/**
 * The browser's WebSocket URL from a DevToolsActivePort file: the port on the
 * first line, the browser target's path on the second.
 */
export function parseDevToolsActivePort(text: string): string | undefined {
  const [port, path] = text.split('\n')
  const number = Number(port)
  if (!Number.isInteger(number) || number < 1 || number > 65_535) return undefined
  if (path === undefined || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(path)) return undefined
  return `ws://127.0.0.1:${number}${path}`
}

export async function startChromium(
  subprocess: SubprocessRuntime,
  display: number,
  options: ChromiumOptions,
): Promise<RunningChromium> {
  let executable: string
  try {
    executable = await subprocess.resolveExecutable(options.command)
  } catch (error) {
    throw new ProgramMissing('chromium', options.command, error)
  }
  await mkdir(options.profileDir, { recursive: true, mode: 0o700 })
  const portFile = join(options.profileDir, 'DevToolsActivePort')
  // A file left by an earlier run would name a port nothing listens on.
  await rm(portFile, { force: true })
  const child = subprocess.spawn({
    argv: [
      executable,
      `--user-data-dir=${options.profileDir}`,
      '--remote-debugging-port=0',
      '--no-startup-window',
      '--no-first-run',
      '--no-default-browser-check',
      // The profile's secrets are encrypted with a fixed key rather than a
      // desktop keyring, which this headless session does not have.
      '--password-store=basic',
      '--hide-crash-restore-bubble',
      ...options.flags,
    ],
    cwd: homedir(),
    env: {
      DISPLAY: `:${display}`,
      ...(options.language === '' ? {} : { LANGUAGE: options.language }),
    },
    graceMs: 5_000,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4 * 1024 }, stderr: STDERR },
  })
  let exited = false
  void child.done.then(
    () => (exited = true),
    () => (exited = true),
  )
  for (const deadline = Date.now() + STARTUP_TIMEOUT_MS; Date.now() < deadline; await sleep(100)) {
    if (exited) throw new Error(`Chromium exited: ${stderrOf(child)}`)
    const text = await readFile(portFile, 'utf8').catch(() => undefined)
    const url = text === undefined ? undefined : parseDevToolsActivePort(text)
    if (url !== undefined) return { process: child, url }
  }
  child.terminate()
  throw new Error(`Chromium did not open its DevTools port: ${stderrOf(child)}`)
}

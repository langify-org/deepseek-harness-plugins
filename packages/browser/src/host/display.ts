// The X display the browser draws on: Xvnc, a virtual X server that serves its
// screen over VNC. VNC listens on a unix socket only this user can open, and on
// no TCP port; Xvnc picks a free display number and reports it on stdout.
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { setTimeout as sleep } from 'node:timers/promises'
import type { SubprocessHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { Size } from '../protocol.ts'
import { ProgramMissing } from './errors.ts'

export interface Display {
  /** The X display number: DISPLAY is `:<number>`. */
  readonly number: number
  /** Where VNC listens. */
  readonly socketPath: string
  readonly process: SubprocessHandle
}

const STARTUP_TIMEOUT_MS = 15_000
const STDERR = { maxBytes: 16 * 1024 }

/** The display number Xvnc wrote with `-displayfd`, once its line is complete. */
export function parseDisplayNumber(output: string): number | undefined {
  const match = /^(\d+)\n/.exec(output)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

/** Start Xvnc with a screen of `size`, serving VNC at `socketPath`. */
export async function startDisplay(
  subprocess: SubprocessRuntime,
  command: string,
  socketPath: string,
  size: Size,
): Promise<Display> {
  let executable: string
  try {
    executable = await subprocess.resolveExecutable(command)
  } catch (error) {
    throw new ProgramMissing('xvnc', command, error)
  }
  const child = subprocess.spawn({
    argv: [
      executable,
      '-displayfd',
      '1',
      '-rfbunixpath',
      socketPath,
      // No TCP listener at all: the unix socket's mode (0600 by default) is the access control.
      '-rfbport',
      '-1',
      '-SecurityTypes',
      'None',
      // Several tabs, or several devices, may view the screen at once.
      '-AlwaysShared',
      // Only an explicit copy reaches the user's clipboard, not every selection (X11's PRIMARY).
      '-SendPrimary=0',
      '-geometry',
      `${size.width}x${size.height}`,
      '-depth',
      '24',
      '-desktop',
      'DSH browser',
    ],
    cwd: homedir(),
    graceMs: 2_000,
    stdio: { stdin: 'ignore', stdout: 'pipe', stderr: STDERR },
  })
  try {
    const number = await displayNumber(child)
    await waitForSocket(socketPath, child)
    return { number, socketPath, process: child }
  } catch (error) {
    child.terminate()
    throw error
  }
}

async function displayNumber(child: SubprocessHandle): Promise<number> {
  const stdout = child.stdout
  if (stdout === undefined) throw new Error('Xvnc has no stdout')
  stdout.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => fail('Xvnc did not report its display'), STARTUP_TIMEOUT_MS)
    const fail = (message: string): void => {
      clearTimeout(timer)
      reject(new Error(`${message}: ${stderrOf(child)}`))
    }
    stdout.on('data', (chunk: string) => {
      output += chunk
      const number = parseDisplayNumber(output)
      if (number === undefined) return
      clearTimeout(timer)
      resolve(number)
    })
    void child.done.then(
      () => fail('Xvnc exited'),
      () => fail('Xvnc failed'),
    )
  })
}

async function waitForSocket(path: string, child: SubprocessHandle): Promise<void> {
  let exited = false
  void child.done.then(
    () => (exited = true),
    () => (exited = true),
  )
  for (const deadline = Date.now() + STARTUP_TIMEOUT_MS; Date.now() < deadline; await sleep(50)) {
    if (exited) throw new Error(`Xvnc exited: ${stderrOf(child)}`)
    const found = await stat(path).catch(() => undefined)
    if (found?.isSocket() === true) return
  }
  throw new Error(`Xvnc did not open ${path}`)
}

export function stderrOf(child: SubprocessHandle): string {
  return child.collected.stderr?.readFrom(0).text.trim().split('\n').slice(-5).join('\n') ?? ''
}

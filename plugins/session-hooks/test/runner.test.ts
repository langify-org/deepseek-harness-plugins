import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { runCommand, succeeded, type RunRequest } from '../src/runner.ts'
import { isAlive, sh, tempDir, waitFor } from './helpers.ts'

const base = (overrides: Partial<RunRequest>): RunRequest => ({
  command: 'true',
  shell: 'bash',
  cwd: process.cwd(),
  env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  stdin: '',
  timeoutMs: 10_000,
  ...overrides,
})

describe('runCommand', () => {
  it('passes stdin, environment, and working directory', async () => {
    const dir = await tempDir()
    const result = await runCommand(
      base({ command: 'cat; echo; pwd; echo "$GREETING"', cwd: dir, env: { ...process.env, GREETING: 'hi' }, stdin: '{"a":1}\n' }),
    )
    assert.equal(succeeded(result), true)
    assert.equal(result.stdout, `{"a":1}\n\n${dir}\nhi\n`)
  })

  it('reports a non-zero exit with stderr', async () => {
    const result = await runCommand(base({ command: 'echo broken >&2; exit 3' }))
    assert.equal(succeeded(result), false)
    assert.equal(result.exitCode, 3)
    assert.equal(result.stderr, 'broken\n')
  })

  it('stops the whole process group on timeout', async () => {
    const dir = await tempDir()
    const pidFile = join(dir, 'pid')
    const started = Date.now()
    const result = await runCommand(base({ command: `sleep 30 & echo $! > ${sh(pidFile)}; wait`, timeoutMs: 300 }))
    assert.equal(result.timedOut, true)
    assert.equal(succeeded(result), false)
    assert.ok(Date.now() - started < 5000, 'returns soon after the timeout')
    const child = Number(await readFile(pidFile, 'utf8'))
    await waitFor(() => (isAlive(child) ? undefined : true))
  })

  it('stops the process group when cancelled', async () => {
    const controller = new AbortController()
    const running = runCommand(base({ command: 'sleep 30', signal: controller.signal }))
    setTimeout(() => controller.abort(), 100)
    const result = await running
    assert.equal(result.aborted, true)
    assert.equal(result.timedOut, false)
  })

  it('does not wait for background children that keep stdout open', async () => {
    const dir = await tempDir()
    const pidFile = join(dir, 'pid')
    const started = Date.now()
    const result = await runCommand(base({ command: `sleep 30 & echo $! > ${sh(pidFile)}; echo done`, drainMs: 200 }))
    assert.equal(succeeded(result), true)
    assert.equal(result.stdout, 'done\n')
    assert.ok(Date.now() - started < 3000, 'returns after the drain period')
    process.kill(Number(await readFile(pidFile, 'utf8')), 'SIGKILL')
  })

  it('reports a shell that cannot start', async () => {
    const result = await runCommand(base({ shell: '/nonexistent/shell' }))
    assert.equal(succeeded(result), false)
    assert.match(result.spawnError ?? '', /ENOENT/)
  })

  it('keeps only the tail of very large output', async () => {
    const result = await runCommand(base({ command: 'head -c 3000000 /dev/zero | tr "\\0" x; echo; echo \'{"workdir":"/tmp"}\'' }))
    assert.equal(succeeded(result), true)
    assert.ok(result.stdout.length <= 1024 * 1024)
    assert.ok(result.stdout.endsWith('{"workdir":"/tmp"}\n'))
  })
})

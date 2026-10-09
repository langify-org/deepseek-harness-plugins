/**
 * The plugin on a real Cordis context: DSH's `agent/created` and
 * `domain/changed` events drive real hook processes.
 */
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it, mock } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import * as plugin from '../src/index.ts'
import type { ConfigInput } from '../src/index.ts'
import { isAlive, sh, tempDir, waitFor } from './helpers.ts'

interface FakeHeader {
  id: string
  cwd?: string
  origin?: 'subagent'
  parentSession?: string
}

function fakeAgent(header: FakeHeader): { agent: Agent; injected: UserMessage[] } {
  const injected: UserMessage[] = []
  const agent = { session: { header: { isSeeded: false, createdAt: 0, ...header } }, inject: (message: UserMessage) => injected.push(message) }
  return { agent: agent as unknown as Agent, injected }
}

async function mount(config: ConfigInput, services: Record<string, unknown> = {}) {
  const root = new Context()
  await root.plugin({
    name: 'fake-services',
    apply(ctx: Context) {
      for (const [name, value] of Object.entries(services)) ctx.provide(name, value)
    },
  })
  const fiber = await root.plugin(plugin, config)
  return { root, fiber }
}

const archiveSet = (archivedSessionIds: string[]): DomainChanged => ({
  domain: 'workspace',
  table: '',
  key: '',
  operation: 'put',
  value: { workspaceIds: [], archivedSessionIds, pinnedSessionIds: [] },
})

const readJson = async (file: string) => JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
const tryReadJson = (file: string) => readJson(file).catch(() => undefined)

describe('session start', () => {
  it('runs start commands in order, chains workdir, records it, and tells the model', async () => {
    const dir = await tempDir()
    const project = join(dir, 'project')
    const worktree = join(dir, 'worktree')
    await mkdir(project)
    await mkdir(worktree)
    const { root, fiber } = await mount({
      stateDir: join(dir, 'state'),
      sessionStart: [
        `cat > ${sh(join(dir, 'first.json'))}; env | grep '^DSH_\\(HOOK\\|SESSION\\)' | sort > ${sh(join(dir, 'first.env'))}; echo preparing; echo ${sh(JSON.stringify({ workdir: worktree }))}`,
        `cat > ${sh(join(dir, 'second.json'))}; echo '{"context": "Branch: feature/x"}'`,
      ],
    })
    const { agent, injected } = fakeAgent({ id: 'session-1', cwd: project })

    await root.serial('agent/created', { agent, source: 'startup' })

    assert.deepEqual(await readJson(join(dir, 'first.json')), {
      hook_event_name: 'SessionStart',
      session_id: 'session-1',
      cwd: project,
      workdir: null,
      source: 'startup',
    })
    assert.equal((await readJson(join(dir, 'second.json'))).workdir, worktree)
    assert.equal(
      await readFile(join(dir, 'first.env'), 'utf8'),
      `DSH_HOOK_EVENT=SessionStart\nDSH_HOOK_SOURCE=startup\nDSH_SESSION_CWD=${project}\nDSH_SESSION_ID=session-1\n`,
    )
    assert.equal(injected.length, 1)
    const message = injected[0]!
    assert.equal(message.role, 'user')
    assert.deepEqual(message.source, {
      kind: 'langify-session-hooks',
      form: 'notice',
      summary: `Session start hook: working directory ${worktree}`,
    })
    const text = message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
    assert.match(text, new RegExp(`working directory is ${worktree}`))
    assert.match(text, /Branch: feature\/x/)
    const record = await readJson(join(dir, 'state', 'sessions', 'session-1.json'))
    assert.equal(record.workdir, worktree)
    assert.equal(record.cwd, project)
    await fiber.dispose()
  })

  it('skips resumed sessions and subagents unless configured', async () => {
    const dir = await tempDir()
    const marker = `touch ${sh(join(dir, 'ran-'))}"$DSH_SESSION_ID"`
    const { root, fiber } = await mount({ stateDir: join(dir, 'state'), sessionStart: [marker, `touch ${sh(join(dir, 'any'))}`] })
    await root.serial('agent/created', { agent: fakeAgent({ id: 'resumed', cwd: dir }).agent, source: 'resume' })
    await root.serial('agent/created', { agent: fakeAgent({ id: 'child', cwd: dir, origin: 'subagent' }).agent, source: 'startup' })
    await assert.rejects(readFile(join(dir, 'any')), 'no start command ran')
    await fiber.dispose()

    const opted = await mount({
      stateDir: join(dir, 'state'),
      startSources: ['startup', 'resume'],
      includeSubagents: true,
      sessionStart: [marker],
    })
    await opted.root.serial('agent/created', { agent: fakeAgent({ id: 'resumed', cwd: dir }).agent, source: 'resume' })
    await opted.root.serial('agent/created', { agent: fakeAgent({ id: 'child', cwd: dir, origin: 'subagent' }).agent, source: 'startup' })
    await readFile(join(dir, 'ran-resumed'))
    await readFile(join(dir, 'ran-child'))
    await opted.fiber.dispose()
  })

  it('keeps going when a command fails or returns a missing workdir', async () => {
    const dir = await tempDir()
    const { root, fiber } = await mount({
      stateDir: join(dir, 'state'),
      sessionStart: [
        `echo '{"workdir": "/definitely/missing"}'`,
        `echo '{"context": "ignored because the command fails"}'; exit 7`,
      ],
    })
    const { agent, injected } = fakeAgent({ id: 'session-2', cwd: dir })
    const stderr = mock.method(process.stderr, 'write', () => true)
    try {
      await root.serial('agent/created', { agent, source: 'startup' })
    } finally {
      stderr.mock.restore()
    }
    assert.equal(injected.length, 0)
    assert.equal((await readJson(join(dir, 'state', 'sessions', 'session-2.json'))).workdir, null)

    const warnings = stderr.mock.calls.map((call) => String(call.arguments[0]))
    assert.equal(warnings.length, 2)
    assert.match(warnings[0]!, /^\[langify-session-hooks\] SessionStart command #1 for session-2: workdir \/definitely\/missing is not an existing directory; ignored/)
    assert.match(warnings[1]!, /SessionStart command #2 for session-2 exited with code 7 \(details: .*hooks\.log\)/)

    const log = (await readFile(join(dir, 'state', 'hooks.log'), 'utf8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(
      log.map((entry) => [entry.event, entry.sessionId, entry.command, entry.status, entry.exitCode]),
      [
        ['SessionStart', 'session-2', 1, 'ok', 0],
        ['SessionStart', 'session-2', 2, 'failed', 7],
      ],
    )
    assert.equal(log[1].stdout, '{"context": "ignored because the command fails"}\n')
    await fiber.dispose()
  })
})

describe('session archive', () => {
  it('runs archive and unarchive commands with the recorded workdir', async () => {
    const dir = await tempDir()
    const worktree = join(dir, 'worktree')
    await mkdir(worktree)
    const registry = { archivedSessionIds: ['archived-earlier'] }
    const { root, fiber } = await mount(
      {
        stateDir: join(dir, 'state'),
        sessionStart: [`echo ${sh(JSON.stringify({ workdir: worktree }))}`],
        sessionArchive: [`cat > ${sh(join(dir, 'archive-'))}"$DSH_SESSION_ID.json"`],
        sessionUnarchive: [`cat > ${sh(join(dir, 'unarchive-'))}"$DSH_SESSION_ID.json"`],
      },
      { workspaceRegistry: registry },
    )
    await root.serial('agent/created', { agent: fakeAgent({ id: 'session-3', cwd: dir }).agent, source: 'startup' })

    root.emit('domain/changed', archiveSet(['archived-earlier', 'session-3']))
    const archived = await waitFor(() => tryReadJson(join(dir, 'archive-session-3.json')))
    assert.deepEqual(archived, { hook_event_name: 'SessionArchive', session_id: 'session-3', cwd: dir, workdir: worktree })
    await assert.rejects(readFile(join(dir, 'archive-archived-earlier.json')), 'sessions archived before start never fire')

    root.emit('domain/changed', { ...archiveSet(['archived-earlier']), domain: 'settings' })
    root.emit('domain/changed', archiveSet(['archived-earlier']))
    const restored = await waitFor(() => tryReadJson(join(dir, 'unarchive-session-3.json')))
    assert.equal(restored.hook_event_name, 'SessionUnarchive')
    assert.equal(restored.workdir, worktree)
    await fiber.dispose()
  })

  it('stops running hooks when the plugin unloads', async () => {
    const dir = await tempDir()
    const pidFile = join(dir, 'pid')
    const { root, fiber } = await mount(
      { stateDir: join(dir, 'state'), sessionArchive: [`sleep 30 & echo $! > ${sh(pidFile)}; wait`] },
      { workspaceRegistry: { archivedSessionIds: [] } },
    )
    root.emit('domain/changed', archiveSet(['session-4']))
    const pid = await waitFor(async () => {
      const text = await readFile(pidFile, 'utf8').catch(() => '')
      return text.trim() === '' ? undefined : Number(text)
    })
    const started = Date.now()
    await fiber.dispose()
    assert.ok(Date.now() - started < 5000, 'disposal does not wait for the hook to finish')
    await waitFor(() => (isAlive(pid) ? undefined : true))
  })
})

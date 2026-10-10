import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { branchName, nameProblem, workbenchDir } from '../src/names.ts'
import { WorkbenchStore } from '../src/state.ts'
import { moveToTrash } from '../src/trash.ts'
import { WorkbenchError, Workbenches, type Registry, type RegistryWorkspace } from '../src/workbenches.ts'

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-'))
  after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

async function repo(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  await writeFile(join(dir, 'README.md'), '# repo\n')
  git(dir, 'add', 'README.md')
  git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'init')
  return dir
}

/** An in-memory Workspace registry with DSH's ordering rules. */
class FakeRegistry implements Registry {
  readonly workspaces: (RegistryWorkspace & { sessionIds: string[] })[] = []
  readonly archived: string[] = []
  private next = 1

  get archivedSessionIds(): readonly string[] {
    return this.archived
  }
  add(path: string, title: string, sessionIds: string[] = []) {
    const workspace = { id: `ws-${this.next++}`, path, title, sessionIds }
    this.workspaces.push(workspace)
    return workspace
  }
  list() {
    return [...this.workspaces]
  }
  get(id: string) {
    return this.workspaces.find((workspace) => workspace.id === id)
  }
  async create(path: string, title?: string) {
    const workspace = { id: `ws-${this.next++}`, path, title: title ?? path, sessionIds: [] as string[] }
    this.workspaces.unshift(workspace)
    return workspace
  }
  async delete(id: string) {
    const index = this.workspaces.findIndex((workspace) => workspace.id === id)
    if (index === -1) return false
    this.workspaces.splice(index, 1)
    return true
  }
  async insertBefore(id: string, beforeId?: string) {
    const moved = this.workspaces.splice(this.workspaces.findIndex((workspace) => workspace.id === id), 1)[0]!
    const index = beforeId === undefined ? this.workspaces.length : this.workspaces.findIndex((workspace) => workspace.id === beforeId)
    this.workspaces.splice(index, 0, moved)
    return this.workspaces.map((workspace) => workspace.id)
  }
  async resolveByPath(path: string) {
    return this.workspaces.find((workspace) => workspace.path === path)
  }
  async archiveSession(sessionId: string) {
    this.archived.push(sessionId)
  }
}

async function setup() {
  const dir = await tempDir()
  const registry = new FakeRegistry()
  const closedTerminals: string[] = []
  const workbenches = new Workbenches({
    registry,
    store: new WorkbenchStore(join(dir, 'state', 'workbenches.json')),
    root: join(dir, 'benches'),
    branchPrefix: 'wb/',
    env: { XDG_DATA_HOME: join(dir, 'data') },
    closeTerminals: async (sessionId) => {
      closedTerminals.push(sessionId)
      return 1
    },
  })
  return { dir, registry, workbenches, closedTerminals }
}

describe('names', () => {
  it('accepts simple names and rejects unsafe ones', () => {
    assert.equal(nameProblem('feature-a'), undefined)
    assert.equal(nameProblem('fix_1.2'), undefined)
    for (const bad of ['', '-a', 'a b', 'a/b', 'a..b', 'a.', 'a.lock', 'x'.repeat(64), 3]) assert.notEqual(nameProblem(bad), undefined, String(bad))
  })
  it('places workbenches under the root by parent directory name', () => {
    assert.equal(workbenchDir('/r', '/home/me/app', 'x'), '/r/app/x')
    assert.equal(branchName('wb/', 'x'), 'wb/x')
  })
})

describe('Workbenches with a git parent', () => {
  it('creates a worktree on wb/<name>, registers it after its parent, and lists it', async () => {
    const { dir, registry, workbenches } = await setup()
    const app = await repo(join(dir, 'app'))
    const parent = registry.add(app, 'app', ['session-1'])
    const other = registry.add(join(dir, 'other'), 'other')

    const first = await workbenches.create({ sessionId: 'session-1', name: 'feature-a' })
    assert.equal(first.title, 'app/feature-a')
    assert.equal(first.branch, 'wb/feature-a')
    assert.equal(first.path, join(dir, 'benches', 'app', 'feature-a'))
    assert.equal(git(first.path, 'rev-parse', '--abbrev-ref', 'HEAD'), 'wb/feature-a')
    // Creating from inside a workbench makes a sibling, placed after the first one.
    registry.get(first.workspaceId)!.sessionIds.push('session-2')
    const second = await workbenches.create({ sessionId: 'session-2', name: 'feature-b' })
    assert.equal(second.parentWorkspaceId, parent.id)
    assert.deepEqual(
      registry.list().map((workspace) => workspace.title),
      ['app', 'app/feature-a', 'app/feature-b', 'other'],
    )
    assert.equal(registry.list().at(-1)!.id, other.id)

    await writeFile(join(first.path, 'new.txt'), 'x')
    const listed = await workbenches.list({ workspaceId: parent.id })
    assert.equal(listed.parent?.title, 'app')
    assert.equal(listed.current, parent.id)
    const fromInside = await workbenches.list({ sessionId: 'session-2' })
    assert.equal(fromInside.parent?.workspaceId, parent.id)
    assert.equal(fromInside.current, first.workspaceId, "session-2 lives in feature-a")
    assert.deepEqual(
      listed.workbenches.map((entry) => [entry.name, entry.changes, entry.exists, entry.registered]),
      [
        ['feature-a', 1, true, true],
        ['feature-b', 0, true, true],
      ],
    )
  })

  it('refuses duplicate names and invalid names', async () => {
    const { dir, registry, workbenches } = await setup()
    const app = await repo(join(dir, 'app'))
    const parent = registry.add(app, 'app')
    await workbenches.create({ workspaceId: parent.id, name: 'x' })
    await assert.rejects(workbenches.create({ workspaceId: parent.id, name: 'x' }), /already has a workbench named x/)
    await assert.rejects(workbenches.create({ workspaceId: parent.id, name: '../x' }), WorkbenchError)
    await assert.rejects(workbenches.create({ sessionId: 'unknown', name: 'y' }), /could not tell which Workspace/)
  })

  it('removes a clean workbench: closes terminals, archives its Sessions, removes the worktree, deletes the merged branch', async () => {
    const { dir, registry, workbenches, closedTerminals } = await setup()
    const app = await repo(join(dir, 'app'))
    const parent = registry.add(app, 'app')
    const bench = await workbenches.create({ workspaceId: parent.id, name: 'done' })
    registry.get(bench.workspaceId)!.sessionIds.push('s-a', 's-b')
    registry.archived.push('s-b')

    const result = await workbenches.remove({ workspaceId: bench.workspaceId })
    assert.deepEqual(result, { archivedSessions: 1, directory: 'worktree-removed', branch: { deleted: true } })
    assert.deepEqual(registry.archived, ['s-b', 's-a'])
    assert.deepEqual(closedTerminals, ['s-a', 's-b'], 'terminals close even in already-archived Sessions')
    assert.equal(registry.get(bench.workspaceId), undefined)
    assert.equal(git(app, 'branch', '--list', 'wb/done'), '')
    assert.deepEqual((await workbenches.list()).workbenches, [])
  })

  it('refuses to remove a workbench with uncommitted changes, and keeps an unmerged branch', async () => {
    const { dir, registry, workbenches } = await setup()
    const app = await repo(join(dir, 'app'))
    const parent = registry.add(app, 'app')
    const bench = await workbenches.create({ workspaceId: parent.id, name: 'wip' })
    await writeFile(join(bench.path, 'wip.txt'), 'x')
    await assert.rejects(workbenches.remove({ workspaceId: bench.workspaceId }), /1 uncommitted change/)
    assert.notEqual(registry.get(bench.workspaceId), undefined, 'nothing was removed')

    git(bench.path, 'add', 'wip.txt')
    git(bench.path, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'wip')
    const result = await workbenches.remove({ workspaceId: bench.workspaceId })
    assert.equal(result.directory, 'worktree-removed')
    assert.equal(result.branch?.deleted, false)
    assert.notEqual(git(app, 'branch', '--list', 'wb/wip'), '', 'the unmerged branch is kept')
  })
})

describe('Workbenches with a non-git parent', () => {
  it('creates a plain directory and moves it to the trash on removal', async () => {
    const { dir, registry, workbenches } = await setup()
    await mkdir(join(dir, 'notes'))
    const parent = registry.add(join(dir, 'notes'), 'notes')
    const bench = await workbenches.create({ workspaceId: parent.id, name: 'draft' })
    assert.equal(bench.branch, null)
    await writeFile(join(bench.path, 'a.txt'), 'keep me')

    const result = await workbenches.remove({ workspaceId: bench.workspaceId })
    assert.deepEqual(result, { archivedSessions: 0, directory: 'trashed', branch: null })
    const trash = join(dir, 'data', 'Trash')
    assert.deepEqual(await readdir(join(trash, 'files')), ['draft'])
    assert.equal(await readFile(join(trash, 'files', 'draft', 'a.txt'), 'utf8'), 'keep me')
    assert.match(await readFile(join(trash, 'info', 'draft.trashinfo'), 'utf8'), /^\[Trash Info\]\nPath=.*\/draft\nDeletionDate=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\n$/)
  })
})

describe('moveToTrash', () => {
  it('picks a free name when the trash already has one', async () => {
    const dir = await tempDir()
    const env = { XDG_DATA_HOME: join(dir, 'data') }
    for (const round of [1, 2]) {
      await mkdir(join(dir, 'x'))
      await writeFile(join(dir, 'x', 'n'), String(round))
      await moveToTrash(join(dir, 'x'), env)
    }
    assert.deepEqual((await readdir(join(dir, 'data', 'Trash', 'files'))).sort(), ['x', 'x.1'])
  })
})

/**
 * Create, list, and remove workbenches: directories derived from a parent
 * Workspace and registered as Workspaces of their own.
 */
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { changeCount, git, gitOrThrow, gitTopLevel } from './git.ts'
import { branchName, nameProblem, workbenchDir, workbenchTitle } from './names.ts'
import type { CreateRequest, ListRequest, ListResponse, RemoveRequest, RemoveResponse, Workbench, WorkbenchStatus } from './protocol.ts'
import type { WorkbenchStore } from './state.ts'
import { moveToTrash } from './trash.ts'

/** The parts of DSH's `ctx.workspaceRegistry` this module uses. */
export interface Registry {
  list(): readonly RegistryWorkspace[]
  get(id: string): RegistryWorkspace | undefined
  create(path: string, title?: string): Promise<RegistryWorkspace>
  delete(id: string): Promise<boolean>
  insertBefore(id: string, beforeId?: string): Promise<readonly string[]>
  resolveByPath(path: string): Promise<RegistryWorkspace | undefined>
  readonly archivedSessionIds: readonly string[]
  archiveSession(sessionId: string, options?: { stopActivity?: boolean }): Promise<void>
}

export interface RegistryWorkspace {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

export interface WorkbenchesOptions {
  readonly registry: Registry
  readonly store: WorkbenchStore
  /** Directory holding every workbench: `<root>/<parent directory name>/<name>`. */
  readonly root: string
  readonly branchPrefix: string
  /** The working directory a live Session was created in, when DSH still has it. */
  readonly sessionCwd?: (sessionId: string) => string | undefined
  /**
   * Close the user terminals a Session has open. Archiving leaves them running,
   * and a shell would otherwise stay in the removed directory.
   * @returns how many were closed.
   */
  readonly closeTerminals?: (sessionId: string) => Promise<number>
  readonly env?: NodeJS.ProcessEnv
}

/** A request the caller should fix; reported to the user as is. */
export class WorkbenchError extends Error {
  override readonly name = 'WorkbenchError'
}

export class Workbenches {
  private readonly options: WorkbenchesOptions
  private tail: Promise<unknown> = Promise.resolve()

  constructor(options: WorkbenchesOptions) {
    this.options = options
  }

  /** Mutations run one at a time, so two creates cannot race for a name or the order. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task)
    this.tail = result.catch(() => {})
    return result
  }

  async list(request: ListRequest = {}): Promise<ListResponse> {
    const parent = request.sessionId !== undefined || request.workspaceId !== undefined ? await this.parentOf(request) : undefined
    const all = await this.options.store.all()
    const chosen = parent === undefined ? all : all.filter((workbench) => workbench.parentWorkspaceId === parent.id)
    const workbenches = await Promise.all(chosen.map((workbench) => this.status(workbench)))
    const sessionId = request.sessionId
    const current = sessionId === undefined ? undefined : this.options.registry.list().find((workspace) => workspace.sessionIds.includes(sessionId))
    return {
      parent: parent === undefined ? null : { workspaceId: parent.id, title: parent.title, path: parent.path },
      current: current?.id ?? request.workspaceId ?? null,
      workbenches,
    }
  }

  create(request: CreateRequest): Promise<Workbench> {
    return this.serial(async () => {
      const problem = nameProblem(request.name)
      if (problem !== undefined) throw new WorkbenchError(`invalid workbench name: ${problem}`)
      const name = request.name
      const parent = await this.parentOf(request)
      const all = await this.options.store.all()
      if (all.some((workbench) => workbench.parentWorkspaceId === parent.id && workbench.name === name)) {
        throw new WorkbenchError(`${parent.title} already has a workbench named ${name}`)
      }
      const path = workbenchDir(this.options.root, parent.path, name)
      if (await exists(path)) throw new WorkbenchError(`${path} already exists`)

      const topLevel = await gitTopLevel(parent.path)
      let branch: string | null = null
      await mkdir(dirname(path), { recursive: true })
      if (topLevel !== undefined) {
        branch = branchName(this.options.branchPrefix, name)
        const existing = await git(topLevel, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])
        await gitOrThrow(topLevel, existing.code === 0 ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, 'HEAD'])
      } else {
        await mkdir(path)
      }

      const title = workbenchTitle(parent.title, name)
      const workspace = await this.options.registry.create(path, title)
      const workbench: Workbench = {
        name,
        title,
        workspaceId: workspace.id,
        parentWorkspaceId: parent.id,
        parentPath: topLevel ?? parent.path,
        path,
        branch,
        createdAt: new Date().toISOString(),
      }
      await this.options.store.put(workbench)
      await this.placeAfterParent(workbench, [...all, workbench])
      return workbench
    })
  }

  remove(request: RemoveRequest): Promise<RemoveResponse> {
    return this.serial(async () => {
      const workbench = (await this.options.store.all()).find((entry) => entry.workspaceId === request.workspaceId)
      if (workbench === undefined) throw new WorkbenchError('this Workspace is not a workbench')
      const present = await exists(workbench.path)
      if (present && workbench.branch !== null) {
        const changes = await changeCount(workbench.path)
        if (changes === null) throw new WorkbenchError(`git cannot read ${workbench.path}; remove it by hand`)
        if (changes > 0) {
          throw new WorkbenchError(`${workbench.title} has ${changes} uncommitted change${changes === 1 ? '' : 's'}; commit or discard them first`)
        }
      }

      const archivedSessions = await this.archiveSessions(workbench.workspaceId)

      let directory: RemoveResponse['directory'] = 'already-gone'
      let branch: RemoveResponse['branch'] = null
      if (workbench.branch !== null) {
        if (present) {
          await gitOrThrow(workbench.parentPath, ['worktree', 'remove', workbench.path])
          directory = 'worktree-removed'
        } else {
          await git(workbench.parentPath, ['worktree', 'prune'])
        }
        const deleted = await git(workbench.parentPath, ['branch', '-d', workbench.branch])
        branch = deleted.code === 0 ? { deleted: true } : { deleted: false, reason: firstLine(deleted.stderr) || 'git refused to delete it' }
      } else if (present) {
        await moveToTrash(workbench.path, this.options.env)
        directory = 'trashed'
      }

      await this.options.registry.delete(workbench.workspaceId)
      await this.options.store.delete(workbench.workspaceId)
      return { archivedSessions, directory, branch }
    })
  }

  /** The parent Workspace a request names; inside a workbench, that workbench's own parent. */
  private async parentOf(request: { sessionId?: string; workspaceId?: string }): Promise<RegistryWorkspace> {
    const { registry } = this.options
    let workspace: RegistryWorkspace | undefined
    if (request.workspaceId !== undefined) workspace = registry.get(request.workspaceId)
    else if (request.sessionId !== undefined) {
      const sessionId = request.sessionId
      workspace = registry.list().find((candidate) => candidate.sessionIds.includes(sessionId))
      const cwd = workspace === undefined ? this.options.sessionCwd?.(sessionId) : undefined
      if (cwd !== undefined) workspace = await registry.resolveByPath(cwd).catch(() => undefined)
    }
    if (workspace === undefined) throw new WorkbenchError('could not tell which Workspace this belongs to; open a Session in the parent Workspace first')
    const asWorkbench = (await this.options.store.all()).find((entry) => entry.workspaceId === workspace.id)
    if (asWorkbench !== undefined) {
      const parent = registry.get(asWorkbench.parentWorkspaceId)
      if (parent === undefined) throw new WorkbenchError(`the parent Workspace of ${asWorkbench.title} is no longer registered`)
      return parent
    }
    return workspace
  }

  /** Move the new Workspace right after its parent and the parent's other workbenches. */
  private async placeAfterParent(workbench: Workbench, all: readonly Workbench[]): Promise<void> {
    const siblings = new Set(all.filter((entry) => entry.parentWorkspaceId === workbench.parentWorkspaceId).map((entry) => entry.workspaceId))
    const order = this.options.registry.list().map((workspace) => workspace.id).filter((id) => id !== workbench.workspaceId)
    let index = order.indexOf(workbench.parentWorkspaceId)
    if (index === -1) return
    index++
    while (index < order.length && siblings.has(order[index]!)) index++
    await this.options.registry.insertBefore(workbench.workspaceId, order[index])
  }

  private async archiveSessions(workspaceId: string): Promise<number> {
    const { registry } = this.options
    const sessionIds = registry.get(workspaceId)?.sessionIds ?? []
    const archived = new Set(registry.archivedSessionIds)
    let count = 0
    for (const sessionId of sessionIds) {
      await this.options.closeTerminals?.(sessionId)
      if (archived.has(sessionId)) continue
      await registry.archiveSession(sessionId, { stopActivity: true })
      count++
    }
    return count
  }

  private async status(workbench: Workbench): Promise<WorkbenchStatus> {
    const present = await exists(workbench.path)
    return {
      ...workbench,
      exists: present,
      registered: this.options.registry.get(workbench.workspaceId) !== undefined,
      changes: present && workbench.branch !== null ? await changeCount(workbench.path) : null,
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? ''
}

/**
 * The contract between the browser half and the host half.
 *
 * The host registers one exact route per endpoint below `/api` with
 * `ctx.connection.fetch.register`, so requests pass DSH's own Host/Origin
 * checks and browser authentication. The browser POSTs JSON to the
 * mount-relative `api/langify-workbench.<endpoint>` and gets `ApiResult` back.
 * Types and constants only: the client imports this file, so it must stay free
 * of Node imports.
 */

/** Host path of an endpoint: `/api/langify-workbench.<endpoint>`. */
export function endpointPath(endpoint: Endpoint): string {
  return `/api/langify-workbench.${endpoint}`
}

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
/** The right sidebar page type's kind and implementation id. */
export const TAB_KIND = 'langify-workbench'
export const TAB_TYPE_ID = '@langify-org/dsh-workbench/page'

export interface Workbench {
  readonly name: string
  readonly title: string
  readonly workspaceId: string
  readonly parentWorkspaceId: string
  readonly parentPath: string
  readonly path: string
  /** The branch the worktree is on; `null` for a non-git workbench. */
  readonly branch: string | null
  readonly createdAt: string
}

export interface WorkbenchStatus extends Workbench {
  /** The directory still exists. */
  readonly exists: boolean
  /** The Workspace is still registered. */
  readonly registered: boolean
  /** Number of uncommitted changes (`git status --porcelain` lines); `null` outside git or when unknown. */
  readonly changes: number | null
}

/** `list`: the workbenches of one parent (resolved like `create`), or all of them. */
export interface ListRequest {
  readonly sessionId?: string
  readonly workspaceId?: string
}
export interface ListResponse {
  /** The parent the request resolved to, when it named one. */
  readonly parent: { readonly workspaceId: string; readonly title: string; readonly path: string } | null
  /** The Workspace the asking Session belongs to (the parent or one of its workbenches). */
  readonly current: string | null
  readonly workbenches: readonly WorkbenchStatus[]
}

/**
 * `create`: a workbench of the Workspace the Session belongs to (or of
 * `workspaceId`). Creating from inside a workbench makes a sibling.
 */
export interface CreateRequest {
  readonly name: string
  readonly sessionId?: string
  readonly workspaceId?: string
}
export type CreateResponse = Workbench

/** `remove`: archive the workbench's Sessions, clean up its directory, unregister its Workspace. */
export interface RemoveRequest {
  readonly workspaceId: string
}
export interface RemoveResponse {
  readonly archivedSessions: number
  /** What happened to the directory. */
  readonly directory: 'worktree-removed' | 'trashed' | 'already-gone'
  /** For git workbenches: whether the merged branch was deleted, or why it was kept. */
  readonly branch: { readonly deleted: true } | { readonly deleted: false; readonly reason: string } | null
}

export const ENDPOINTS = ['list', 'create', 'remove'] as const
export type Endpoint = (typeof ENDPOINTS)[number]

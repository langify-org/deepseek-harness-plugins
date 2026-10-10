/**
 * @langify-org/dsh-workbench — browser half (prototype).
 *
 * Adds a "Workbench" entry to the right sidebar's Start page. Its page lists the
 * workbenches of the current Session's Workspace and creates new ones: the host
 * makes the worktree and registers it as a Workspace, then this half opens a
 * blank Session there and a terminal beside it.
 */
import { Button, IconBranchOutlineRegular, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import {
  endpointPath,
  TAB_KIND,
  TAB_TYPE_ID,
  type CreateRequest,
  type ApiResult,
  type CreateResponse,
  type Endpoint,
  type ListResponse,
  type RemoveResponse,
  type WorkbenchStatus,
} from '../protocol.ts'
import type { ClientContext } from './dsh.ts'

export const name = 'langify-workbench'
export const inject = ['slots', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs']

interface WorkbenchApi {
  list(sessionId: string): Promise<ListResponse>
  create(request: CreateRequest): Promise<CreateResponse>
  remove(workspaceId: string): Promise<RemoveResponse>
  open(workspaceId: string, options?: { terminal?: boolean }): Promise<void>
}

export function apply(ctx: ClientContext): void {
  const api = createApi(ctx)
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_TYPE_ID,
        kind: TAB_KIND,
        title: () => 'Workbench',
        guide: [
          {
            id: 'workbench',
            order: 300,
            title: () => 'Workbench',
            description: () => 'Make a named place to work, with its own worktree',
            icon: IconBranchOutlineRegular,
          },
        ],
      }),
    'langify-workbench: tab type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: TAB_TYPE_ID, inject: (sessionId: string) => ({ sessionId, api }) },
          WorkbenchPage as never,
        ),
      ),
    'langify-workbench: page',
  )
}

function createApi(ctx: ClientContext): WorkbenchApi {
  // Mount-relative, like DSH's own clients: the page's authentication cookie goes with it.
  const call = async <T,>(endpoint: Endpoint, payload: unknown): Promise<T> => {
    const response = await fetch(endpointPath(endpoint).slice(1), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(`workbench ${endpoint}: HTTP ${response.status}`)
    const result = (await response.json()) as ApiResult<T>
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  return {
    list: (sessionId) => call<ListResponse>('list', { sessionId }),
    create: (request) => call<CreateResponse>('create', request),
    remove: (workspaceId) => call<RemoveResponse>('remove', { workspaceId }),
    async open(workspaceId, options = {}) {
      // The new Workspace reaches this page's Workspace list a moment after the
      // host commits it, so retry the open briefly.
      let sessionId: string | undefined
      for (let attempt = 0; ; attempt++) {
        try {
          await ctx.uiWorkspace.openWorkspace(workspaceId, (id) => {
            sessionId = id
          })
          break
        } catch (error) {
          if (attempt >= 20) throw error
          await sleep(150)
        }
      }
      if (options.terminal === false) return
      // Open the terminal once the new Session is the one on screen, so it lands in its sidebar.
      for (let attempt = 0; attempt < 50 && ctx.sidebarRight.mounted.getSnapshot() !== sessionId; attempt++) await sleep(100)
      if (ctx.sidebarRight.mounted.getSnapshot() === sessionId) ctx.sidebarRight.openTab('terminal')
    },
  }
}

interface PageProps {
  sessionId: string
  api: WorkbenchApi
}

function WorkbenchPage({ sessionId, api }: PageProps) {
  const [listing, setListing] = useState<ListResponse | undefined>()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | undefined>()
  /** The workbench whose Remove button is waiting for a second click. */
  const [confirming, setConfirming] = useState<string | undefined>()

  const refresh = useCallback(async () => {
    try {
      setListing(await api.list(sessionId))
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) })
    }
  }, [api, sessionId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (task: () => Promise<string | undefined>) => {
    setBusy(true)
    setMessage(undefined)
    try {
      const text = await task()
      if (text !== undefined) setMessage({ tone: 'info', text })
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error) })
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const create = () =>
    run(async () => {
      const created = await api.create({ sessionId, name: name.trim() })
      setName('')
      await api.open(created.workspaceId)
      return undefined
    })

  const remove = (workbench: WorkbenchStatus) => {
    if (confirming !== workbench.workspaceId) {
      setConfirming(workbench.workspaceId)
      setMessage({
        tone: 'info',
        text: `Removing ${workbench.title} archives its Sessions and ${workbench.branch === null ? 'moves its directory to the trash' : 'removes its worktree'}. Click Confirm to go ahead.`,
      })
      return
    }
    setConfirming(undefined)
    void run(async () => {
      const result = await api.remove(workbench.workspaceId)
      // This page's own Session was in the removed workbench: go to the parent instead of an empty screen.
      if (listing?.current === workbench.workspaceId && listing.parent !== null) await api.open(listing.parent.workspaceId, { terminal: false })
      const branch = result.branch === null ? '' : result.branch.deleted ? ' Branch deleted.' : ` Branch kept: ${result.branch.reason}`
      return `Removed ${workbench.title}; archived ${result.archivedSessions} Session(s).${branch}`
    })
  }

  return (
    <div style={styles.page}>
      <div style={styles.heading}>Workbench</div>
      <div style={styles.muted}>
        {listing?.parent ? `New workbenches branch off ${listing.parent.title}` : 'Loading…'}
      </div>
      <form
        style={styles.row}
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && name.trim() !== '') void create()
        }}
      >
        <Input
          style={{ flex: 1 }}
          placeholder="feature-a"
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.currentTarget.value)}
          aria-label="Workbench name"
        />
        <Button type="submit" variant="primary" disabled={busy || name.trim() === ''}>
          Create & open
        </Button>
      </form>
      {message && <div style={message.tone === 'error' ? styles.error : styles.info}>{message.text}</div>}
      <div style={styles.list}>
        {listing?.workbenches.length === 0 && <div style={styles.muted}>No workbenches yet.</div>}
        {listing?.workbenches.map((workbench) => (
          <div key={workbench.workspaceId} style={styles.item}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={styles.title}>{workbench.name}</div>
              <div style={styles.muted}>
                {workbench.branch ?? 'no git'}
                {workbench.changes ? ` · ${workbench.changes} uncommitted` : ''}
                {!workbench.exists ? ' · directory missing' : ''}
                {!workbench.registered ? ' · Workspace removed' : ''}
              </div>
            </div>
            <Button size="sm" variant="ghost" disabled={busy || !workbench.registered} onClick={() => void run(async () => (await api.open(workbench.workspaceId), undefined))}>
              Open
            </Button>
            <Button size="sm" variant={confirming === workbench.workspaceId ? 'primary' : 'ghost'} disabled={busy} onClick={() => remove(workbench)}>
              {confirming === workbench.workspaceId ? 'Confirm' : 'Remove'}
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, overflow: 'auto', height: '100%', boxSizing: 'border-box' },
  heading: { fontSize: 15, fontWeight: 600 },
  row: { display: 'flex', gap: 8, alignItems: 'center' },
  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  item: { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(127,127,127,0.25)' },
  title: { fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  muted: { opacity: 0.65, fontSize: 12 },
  error: { color: '#e5534b', fontSize: 12, whiteSpace: 'pre-wrap' },
  info: { fontSize: 12, whiteSpace: 'pre-wrap' },
} satisfies Record<string, CSSProperties>

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

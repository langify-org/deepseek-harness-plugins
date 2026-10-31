import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type JSX,
} from 'react'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { ErrorCode, Responses } from '../rpc.ts'
import { RpcFailure, type Face } from './face.ts'
import { isKey, type NAMESPACE } from './locales.ts'
import { FINAL_PHASES, type Notice } from './session-bus.ts'

export interface CodePageProps extends Face {
  readonly t: TranslateNS<typeof NAMESPACE>
  readonly useTabInfo: UseSidebarRightTabInfo
}

// Same-origin with DSH: this keeps code-server from navigating the DSH page.
const SANDBOX =
  'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads'
const PING_PENDING_MS = 1_000
const PING_READY_MS = 20_000
/** After these, the binding is gone and the page must reconnect. */
const FINAL_ERRORS: ReadonlySet<string> = new Set<ErrorCode>([
  'outcome_unknown',
  'unknown_binding',
  'binding_disconnected',
  'binding_expired',
  'binding_closed',
])

export function CodePage({ bus, call, reveal, t, useTabInfo }: CodePageProps): JSX.Element {
  const { tab } = useTabInfo()
  const state = useSyncExternalStore(bus.subscribe, bus.getSnapshot)
  const [view, setView] = useState<Responses['create']>()
  const [currentCwd, setCurrentCwd] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [drains, setDrains] = useState(0)
  const generation = useRef<string>(undefined)
  const draining = useRef(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const visible = useRef(tab.visible)
  visible.current = tab.visible

  const reconnect = (): void => {
    if (view !== undefined && !window.confirm(t('reconnect.confirm'))) return
    bus.clear()
    bus.notice(undefined)
    setAttempt((value) => value + 1)
  }
  const reconnectRef = useRef(reconnect)
  reconnectRef.current = reconnect
  useEffect(
    () => tab.actions.bindCommands({ refresh: () => reconnectRef.current() }),
    [tab.actions],
  )

  // One binding per mount and per reconnect; a second Code tab defers to the first.
  useLayoutEffect(() => {
    const owner = bus.claim(tab.id)
    if (owner !== undefined) {
      reveal(owner)
      tab.actions.close()
      return undefined
    }
    let disposed = false
    let binding: Responses['create'] | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    generation.current = undefined
    setView(undefined)
    bus.phase('pending')
    const fail = (error: unknown): void => {
      if (disposed) return
      bus.phase('error')
      bus.notice(noticeOf(error))
    }
    const close = (): void => {
      disposed = true
      clearTimeout(timer)
      generation.current = undefined
      if (binding !== undefined)
        void call('close', { bindingId: binding.bindingId }).catch(() => {})
    }
    tab.signal.addEventListener('abort', close, { once: true })
    const ping = async (bindingId: string): Promise<void> => {
      try {
        const status = await call('ping', { bindingId })
        if (disposed) return
        bus.phase(status.state)
        setCurrentCwd(status.currentCwd)
        if (FINAL_PHASES.has(status.state)) return bus.notice({ key: 'notice.ended' })
        timer = setTimeout(
          () => void ping(bindingId),
          status.state === 'pending' ? PING_PENDING_MS : PING_READY_MS,
        )
      } catch (error) {
        fail(error)
      }
    }
    void (async () => {
      try {
        binding = await call('create', { ownerId: crypto.randomUUID() })
        if (disposed) {
          void call('close', { bindingId: binding.bindingId }).catch(() => {})
          return
        }
        generation.current = binding.bindingId
        setView(binding)
        setCurrentCwd(binding.cwd)
        await ping(binding.bindingId)
      } catch (error) {
        fail(error)
      }
    })()
    return () => {
      tab.signal.removeEventListener('abort', close)
      close()
    }
    // tab.actions changes identity across renders; including it would rebind on every render.
  }, [bus, call, reveal, tab.id, tab.signal, attempt])

  // Open queued files one at a time once the window is connected.
  useEffect(() => {
    if (
      view === undefined ||
      state.phase !== 'ready' ||
      draining.current ||
      state.queue.length === 0
    )
      return
    const { bindingId } = view
    draining.current = true
    const drain = async (): Promise<void> => {
      for (let file = bus.take(); file !== undefined; file = bus.take()) {
        try {
          const opened = await call('open', { bindingId, address: file.address, line: file.line })
          if (generation.current !== bindingId) return
          bus.notice({ key: 'opened', params: { path: opened.path, line: opened.line } })
          if (visible.current) frame.current?.focus()
        } catch (error) {
          if (generation.current !== bindingId) return
          bus.notice(noticeOf(error))
          if (error instanceof RpcFailure && FINAL_ERRORS.has(error.code)) return bus.phase('error')
        }
        if (generation.current !== bindingId || bus.getSnapshot().phase !== 'ready') return
      }
    }
    void drain().finally(() => {
      draining.current = false
      if (generation.current !== undefined) setDrains((value) => value + 1)
    })
  }, [view, state.phase, state.queue, bus, call, drains])

  const cwdChanged = view !== undefined && currentCwd !== undefined && currentCwd !== view.cwd
  return (
    <div data-dsh-code-server={state.phase} style={styles.page}>
      <div style={styles.toolbar}>
        <strong>{t('title')}</strong>
        <span role="status">{t(`state.${state.phase}`)}</span>
        <span title={view?.cwd} style={styles.cwd}>
          {view?.cwd}
        </span>
        <button type="button" style={styles.button} onClick={reconnect}>
          {t('reconnect')}
        </button>
      </div>
      {cwdChanged && <div style={styles.message}>{t('cwd.changed', { cwd: currentCwd })}</div>}
      {state.notice !== undefined && (
        <div role="status" style={styles.message}>
          {t(state.notice.key, state.notice.params)}
        </div>
      )}
      {view === undefined ? (
        <div style={styles.placeholder}>{t('loading')}</div>
      ) : (
        <iframe
          ref={frame}
          key={view.bindingId}
          src={view.url}
          title={t('frame', { cwd: view.cwd })}
          sandbox={SANDBOX}
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
          style={styles.frame}
        />
      )}
    </div>
  )
}

function noticeOf(error: unknown): Notice {
  const message = error instanceof Error ? error.message : String(error)
  const key = error instanceof RpcFailure ? `error.${error.code}` : 'error.unexpected'
  return { key: isKey(key) ? key : 'error.unexpected', params: { message } }
}

const styles = {
  page: {
    height: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    fontSize: 12,
    borderBottom: '1px solid var(--dsw-alias-border-l3, #888)',
  },
  cwd: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  button: {
    font: 'inherit',
    padding: '3px 8px',
    border: '1px solid var(--dsw-alias-border-l3, #888)',
    borderRadius: 5,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  message: { fontSize: 12, padding: '4px 8px', overflowWrap: 'anywhere' },
  placeholder: { padding: 16 },
  frame: { display: 'block', flex: 1, width: '100%', minHeight: 0, border: 0 },
} satisfies Record<string, CSSProperties>

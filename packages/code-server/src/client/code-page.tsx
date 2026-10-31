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
import { isMessageKey } from '../messages.ts'
import type { ErrorCode, Responses } from '../rpc.ts'
import { RpcFailure, type Face } from './face.ts'
import type { NAMESPACE } from './locales.ts'
import { FINAL_PHASES, type Notice } from './session-bus.ts'

export interface CodePageProps extends Face {
  readonly t: TranslateNS<typeof NAMESPACE>
  readonly useTabInfo: UseSidebarRightTabInfo
}

// Same-origin with DSH: this keeps code-server from navigating the DSH page.
const SANDBOX =
  'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads'
/** After these, the binding is gone and the page must reconnect. */
const FINAL_ERRORS: ReadonlySet<string> = new Set<ErrorCode>([
  'unknown_binding',
  'binding_disconnected',
  'binding_expired',
  'binding_closed',
])

export function CodePage({ bus, call, reveal, t, useTabInfo }: CodePageProps): JSX.Element {
  const { tab } = useTabInfo()
  const state = useSyncExternalStore(bus.subscribe, bus.getSnapshot)
  const [view, setView] = useState<Responses['create']>()
  const [attempt, setAttempt] = useState(0)
  const [drains, setDrains] = useState(0)
  const generation = useRef<string>(undefined)
  const draining = useRef(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const visible = useRef(tab.visible)
  visible.current = tab.visible

  /** `confirm` is false when the editor asked: it has dealt with unsaved changes itself. */
  const reconnect = (confirm = true): void => {
    if (confirm && view !== undefined && !window.confirm(t('reconnect.confirm'))) return
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
      generation.current = undefined
      if (binding !== undefined)
        void call('close', { bindingId: binding.bindingId }).catch(() => {})
    }
    tab.signal.addEventListener('abort', close, { once: true })
    // Each watch answers as soon as the binding changes, and keeps it alive.
    const watch = async (bindingId: string): Promise<void> => {
      let revision = -1
      for (;;) {
        const status = await call('watch', { bindingId, revision })
        if (disposed) return
        if (status.reconnect) return reconnectRef.current(false)
        bus.phase(status.state)
        if (FINAL_PHASES.has(status.state)) return bus.notice({ key: 'notice.ended' })
        revision = status.revision
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
        await watch(binding.bindingId)
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
          await call('open', { bindingId, address: file.address, line: file.line })
          if (generation.current !== bindingId) return
          // The editor showing the file is the confirmation.
          if (visible.current) frame.current?.focus()
        } catch (error) {
          if (generation.current !== bindingId) return
          // The editor shows the failures the host could report; the page shows
          // a lost connection and failures that never reached the host.
          if (!(error instanceof RpcFailure)) bus.notice(noticeOf(error))
          else if (FINAL_ERRORS.has(error.code)) {
            bus.notice(noticeOf(error))
            return bus.phase('error')
          }
        }
        if (generation.current !== bindingId || bus.getSnapshot().phase !== 'ready') return
      }
    }
    void drain().finally(() => {
      draining.current = false
      if (generation.current !== undefined) setDrains((value) => value + 1)
    })
  }, [view, state.phase, state.queue, bus, call, drains])

  const ended = FINAL_PHASES.has(state.phase)
  const notice = state.notice === undefined ? undefined : t(state.notice.key, state.notice.params)
  const reconnectButton = (
    <button type="button" style={styles.button} onClick={() => reconnect()}>
      {t('reconnect')}
    </button>
  )
  // Without an editor, the page itself explains the state. With one, it shows
  // only what needs attention, and keeps the editor even when the connection
  // ended: it may hold unsaved changes.
  return (
    <div data-dsh-code-server={state.phase} style={styles.page}>
      {view === undefined ? (
        <div role={ended ? 'alert' : 'status'} style={styles.panel}>
          <span>{notice ?? t('loading')}</span>
          {ended && reconnectButton}
        </div>
      ) : (
        <>
          {notice !== undefined && (
            <div role={ended ? 'alert' : 'status'} style={styles.banner}>
              <span style={styles.text}>{notice}</span>
              {ended ? (
                reconnectButton
              ) : (
                <button
                  type="button"
                  aria-label={t('dismiss')}
                  title={t('dismiss')}
                  style={styles.button}
                  onClick={() => bus.notice(undefined)}
                >
                  ×
                </button>
              )}
            </div>
          )}
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
        </>
      )}
    </div>
  )
}

function noticeOf(error: unknown): Notice {
  const message = error instanceof Error ? error.message : String(error)
  const key = error instanceof RpcFailure ? `error.${error.code}` : 'error.unexpected'
  return { key: isMessageKey(key) ? key : 'error.unexpected', params: { message } }
}

const styles = {
  page: {
    height: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    // Sets the editor apart from the tab strip whatever the two themes are.
    padding: 4,
    boxSizing: 'border-box',
  },
  panel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    textAlign: 'center',
    overflowWrap: 'anywhere',
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 8px',
    fontSize: 12,
    borderBottom: '1px solid var(--dsw-alias-border-l3, #888)',
  },
  text: { flex: 1, minWidth: 0, overflowWrap: 'anywhere' },
  button: {
    font: 'inherit',
    padding: '3px 8px',
    border: '1px solid var(--dsw-alias-border-l3, #888)',
    borderRadius: 5,
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
  },
  frame: {
    display: 'block',
    flex: 1,
    width: '100%',
    minHeight: 0,
    border: 0,
    borderRadius: 'var(--dsw-radius-sm, 8px)',
    // code-server declares no color scheme. Inheriting DSH's dark one would make
    // Chrome back the frame with an opaque white canvas, which shows while the
    // editor loads and along edges it leaves uncovered; matching keeps the frame
    // transparent over DSH's own background.
    colorScheme: 'normal',
  },
} satisfies Record<string, CSSProperties>

import { useEffect, useRef, useState, type JSX } from 'react'
import { IconCodeOutlineRegular, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { WTerm } from '@wterm/dom'
import { MouseModes, wheel } from '../mouse.ts'
import { EXITED, NO_TMUX, type ClientMessage } from '../protocol.ts'
import type { NAMESPACE } from './messages.ts'
import { cls } from './styles.ts'

type T = TranslateNS<typeof NAMESPACE>
const RETRY_MS = 1_000

/** A text WebSocket, as DSH's connection opens it. */
export interface Socket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(event: 'open' | 'error', listener: () => void): void
  addEventListener(event: 'message', listener: (event: { readonly data: unknown }) => void): void
  addEventListener(event: 'close', listener: (event: { readonly code?: number }) => void): void
}

export interface TerminalPaneProps {
  readonly sessionId: string
  readonly connect: (cols: number, rows: number) => Socket
  readonly t: T
}

type Status = 'connecting' | 'open' | 'reconnecting' | 'exited' | 'noTmux'

/** The terminal: wterm on one WebSocket, reconnected while tmux runs. */
export function TerminalPane({ sessionId, connect, t }: TerminalPaneProps): JSX.Element {
  const screen = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [run, setRun] = useState(0)

  useEffect(() => {
    const element = screen.current
    if (element === null) return undefined
    let disposed = false
    let socket: Socket | undefined
    let retry: ReturnType<typeof setTimeout> | undefined
    const send = (message: ClientMessage): void => {
      if (socket?.readyState === 1) socket.send(JSON.stringify(message))
    }
    const term = new WTerm(element, {
      autoResize: true,
      cursorBlink: true,
      onData: (data) => send({ type: 'input', data }),
      onResize: (cols, rows) => send({ type: 'resize', cols, rows }),
    })
    const modes = new MouseModes()
    // A swipe scrolls the program when it takes mouse reports (tmux with the mouse
    // on): one wheel step per row the finger moves. wterm only scrolls its own view.
    let lastY: number | undefined
    let carry = 0
    const onTouchStart = (event: TouchEvent): void => {
      lastY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined
      carry = 0
    }
    const onTouchMove = (event: TouchEvent): void => {
      const touch = event.touches[0]
      if (lastY === undefined || touch === undefined || !modes.reports) return
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const rowHeight = box.height / term.rows
      const col = Math.min(
        term.cols,
        Math.max(1, Math.floor(((touch.clientX - box.left) / box.width) * term.cols) + 1),
      )
      const row = Math.min(
        term.rows,
        Math.max(1, Math.floor((touch.clientY - box.top) / rowHeight) + 1),
      )
      carry += touch.clientY - lastY
      lastY = touch.clientY
      // The finger moving down brings earlier lines into view: wheel up.
      while (Math.abs(carry) >= rowHeight) {
        send({ type: 'input', data: wheel(carry > 0, col, row) })
        carry -= Math.sign(carry) * rowHeight
      }
    }
    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: false })
    const open = (): void => {
      if (disposed) return
      const current = connect(term.cols, term.rows)
      socket = current
      current.addEventListener('open', () => setStatus('open'))
      current.addEventListener('message', (event) => {
        const text = String(event.data)
        modes.read(text)
        term.write(text)
      })
      current.addEventListener('close', (event) => {
        if (disposed || socket !== current) return
        if (event.code === EXITED) return setStatus('exited')
        if (event.code === NO_TMUX) return setStatus('noTmux')
        setStatus('reconnecting')
        retry = setTimeout(open, RETRY_MS)
      })
    }
    void term.init().then(() => {
      if (disposed) return
      open()
      term.focus()
    })
    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      disposed = true
      clearTimeout(retry)
      socket?.close()
      term.destroy()
    }
  }, [sessionId, connect, run])

  return (
    <div
      className={cls.root}
      // tmux owns the right button; Shift and a right click, or a long press, keep the browser's menu.
      onContextMenu={(event) => {
        const { nativeEvent } = event
        const touch = 'pointerType' in nativeEvent && nativeEvent.pointerType === 'touch'
        if (!event.shiftKey && !touch) event.preventDefault()
      }}
    >
      <div ref={screen} className={cls.screen} />
      {status !== 'open' && (
        <div className={cls.status} role="status">
          {t(status)}
          {(status === 'exited' || status === 'noTmux') && (
            <button
              type="button"
              onClick={() => {
                setStatus('connecting')
                setRun((n) => n + 1)
              }}
            >
              {t('restart')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function GuideIcon({ className }: IconProps): JSX.Element {
  return (
    <span className={[cls.guideIcon, className].filter(Boolean).join(' ')}>
      <IconCodeOutlineRegular size={18} />
    </span>
  )
}

export function TerminalTitle({ t }: { readonly t: T }): JSX.Element {
  return (
    <span className={cls.title}>
      <IconCodeOutlineRegular size={16} />
      {t('title')}
    </span>
  )
}

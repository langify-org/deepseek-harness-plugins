import { useEffect, useRef, useState, type JSX } from 'react'
import RFB from '@novnc/novnc'
import { IconGlobeOutlineRegular, type IconProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { z } from 'zod'
import {
  CONTROL_PATH,
  DOWNLOAD_PATH,
  UNAVAILABLE,
  UPLOAD_PATH,
  VNC_PATH,
  clampSize,
  serverMessage,
  type ClientMessage,
  type ServerMessage,
  type TabQuery,
  type Unavailable,
} from '../protocol.ts'
import { bridgeInput, focusAt } from './input.ts'
import type { MessageKey, NAMESPACE } from './messages.ts'
import { cls } from './styles.ts'

type T = TranslateNS<typeof NAMESPACE>
const RETRY_MS = 1_000
const RESIZE_DEBOUNCE_MS = 150

/** A WebSocket as DSH's connection opens it: text for the control channel. */
export interface Socket {
  readonly readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(event: 'open' | 'error', listener: () => void): void
  addEventListener(event: 'message', listener: (event: { readonly data: unknown }) => void): void
  addEventListener(event: 'close', listener: (event: { readonly code?: number }) => void): void
}

export interface BrowserPaneProps {
  readonly sessionId: string
  /** Open one of the plugin's WebSockets for a tab. */
  readonly open: (path: string, query: TabQuery) => Socket
  /** The address of one of the plugin's routes on DSH's API channel. */
  readonly apiUrl: (path: string, query: Readonly<Record<string, string>>) => string
  readonly t: T
  readonly useTabInfo: UseSidebarRightTabInfo
}

/** The control channel's state. */
type Channel = 'connecting' | 'open' | 'reconnecting'
type Download = Extract<ServerMessage, { type: 'download' }>
type Upload = Extract<ServerMessage, { type: 'upload' }>

const UNAVAILABLE_TEXT: Record<Unavailable, MessageKey> = {
  xvnc: 'noXvnc',
  chromium: 'noChromium',
  failed: 'failed',
}

const clipboardDetail = z.object({ text: z.string() })

/** One Browser tab: its Chromium window over VNC while it is on the screen. */
export function BrowserPane({
  sessionId,
  open,
  apiUrl,
  t,
  useTabInfo,
}: BrowserPaneProps): JSX.Element {
  const { tab } = useTabInfo()
  const query: TabQuery = { session: sessionId, tab: tab.contentId }
  const screen = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const control = useRef<Socket | undefined>(undefined)
  const [channel, setChannel] = useState<Channel>('connecting')
  /** Whether this tab's window is on the screen; undefined until the host answers the show. */
  const [front, setFront] = useState<boolean>()
  /** Whether the screen stream is connected. */
  const [screenLive, setScreenLive] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [unavailable, setUnavailable] = useState<{ reason: Unavailable; detail: string }>()
  const [downloads, setDownloads] = useState<readonly Download[]>([])
  const [upload, setUpload] = useState<Upload>()
  const [uploading, setUploading] = useState<'sending' | 'failed'>()
  const [blockedCopy, setBlockedCopy] = useState<string>()
  const [attempt, setAttempt] = useState(0)
  const [screenAttempt, setScreenAttempt] = useState(0)
  const chooser = useRef<HTMLInputElement>(null)

  const send = (message: ClientMessage): void => {
    if (control.current?.readyState === 1) control.current.send(JSON.stringify(message))
  }
  const sizeOf = (): { width: number; height: number } => {
    const area = screen.current?.getBoundingClientRect()
    return clampSize(area?.width ?? 0, area?.height ?? 0)
  }
  const show = (): void => send({ type: 'show', ...sizeOf() })

  useEffect(
    () => tab.actions.bindCommands({ refresh: () => setAttempt((n) => n + 1) }),
    // tab.actions changes identity across renders; including it would rebind on every render.
    [],
  )

  // The control channel, while the tab is visible: opening it puts the tab's window on the screen.
  useEffect(() => {
    if (!tab.visible) return undefined
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const connect = (): void => {
      const socket = open(CONTROL_PATH, query)
      control.current = socket
      socket.addEventListener('open', () => {
        setChannel('open')
        setFront(undefined)
        send({ type: 'show', ...sizeOf() })
      })
      socket.addEventListener('message', (event) => {
        const parsed = serverMessage.safeParse(parseJson(String(event.data)))
        if (parsed.success) receive(parsed.data)
      })
      socket.addEventListener('close', (event) => {
        if (disposed || control.current !== socket) return
        setFront(undefined)
        if (event.code === UNAVAILABLE) return
        setChannel('reconnecting')
        retry = setTimeout(connect, RETRY_MS)
      })
    }
    const receive = (message: ServerMessage): void => {
      switch (message.type) {
        case 'front':
          setFront(message.front)
          return
        case 'download':
          setDownloads((list) => [...list.filter((d) => d.id !== message.id), message])
          return
        case 'upload':
          setUpload(message)
          setUploading(undefined)
          return
        case 'uploadClosed':
          setUpload((current) => (current?.id === message.id ? undefined : current))
          return
        case 'unavailable':
          setUnavailable({ reason: message.reason, detail: message.detail })
      }
    }
    connect()
    return () => {
      disposed = true
      clearTimeout(retry)
      control.current?.close()
      control.current = undefined
      setChannel('connecting')
      setFront(undefined)
    }
    // query is rebuilt every render from these two.
  }, [tab.visible, sessionId, tab.contentId, attempt])

  // The screen, while this tab's window is the one on it.
  useEffect(() => {
    const target = screen.current
    const input = box.current
    if (front !== true || target === null || input === null) return undefined
    const socket = open(VNC_PATH, query)
    // noVNC needs the page's own WebSocket, which DSH's web carrier gives.
    if (!(socket instanceof WebSocket)) {
      socket.close()
      setUnsupported(true)
      return undefined
    }
    let disposed = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const rfb = new RFB(target, socket, { shared: true })
    rfb.scaleViewport = true
    rfb.resizeSession = true
    rfb.focusOnClick = false
    rfb.background = 'var(--dsw-alias-bg-base)'
    const unbridge = bridgeInput(input, rfb, (text) => send({ type: 'text', text }), cls.composing)
    const onConnect = (): void => setScreenLive(true)
    const onDisconnect = (): void => {
      if (disposed) return
      setScreenLive(false)
      retry = setTimeout(() => setScreenAttempt((n) => n + 1), RETRY_MS)
    }
    const onClipboard = (event: Event): void => {
      const detail = clipboardDetail.safeParse(
        event instanceof CustomEvent ? event.detail : undefined,
      )
      if (!detail.success) return
      navigator.clipboard.writeText(detail.data.text).then(
        () => setBlockedCopy(undefined),
        () => setBlockedCopy(detail.data.text),
      )
    }
    const onPointerDown = (event: PointerEvent): void => focusAt(input, target, event)
    rfb.addEventListener('connect', onConnect)
    rfb.addEventListener('disconnect', onDisconnect)
    rfb.addEventListener('clipboard', onClipboard)
    target.addEventListener('pointerdown', onPointerDown, true)
    input.focus({ preventScroll: true })
    return () => {
      disposed = true
      clearTimeout(retry)
      target.removeEventListener('pointerdown', onPointerDown, true)
      rfb.removeEventListener('connect', onConnect)
      rfb.removeEventListener('disconnect', onDisconnect)
      rfb.removeEventListener('clipboard', onClipboard)
      unbridge()
      rfb.disconnect()
      setScreenLive(false)
    }
  }, [front, sessionId, tab.contentId, screenAttempt])

  // The window follows the tab's size while it is on the screen; noVNC resizes the screen itself.
  useEffect(() => {
    const target = screen.current
    if (front !== true || target === null) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => send({ type: 'resize', ...sizeOf() }), RESIZE_DEBOUNCE_MS)
    })
    observer.observe(target)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [front])

  const sendFiles = (files: FileList | null): void => {
    if (upload === undefined || files === null || files.length === 0) return
    const form = new FormData()
    for (const file of files) form.append('file', file, file.name)
    setUploading('sending')
    fetch(apiUrl(UPLOAD_PATH, { id: upload.id }), { method: 'POST', body: form }).then(
      (response) => setUploading(response.ok ? undefined : 'failed'),
      () => setUploading('failed'),
    )
  }

  /** Why the screen does not show this tab's window yet, while nothing is wrong. */
  const waiting: MessageKey | undefined =
    channel !== 'open'
      ? channel
      : front === undefined
        ? 'starting'
        : front && !screenLive
          ? 'connecting'
          : undefined

  const cover =
    unavailable !== undefined ? (
      <div className={cls.cover} role="alert">
        {t(UNAVAILABLE_TEXT[unavailable.reason])}
        {unavailable.reason === 'failed' && <code>{unavailable.detail}</code>}
        <button
          type="button"
          onClick={() => {
            setUnavailable(undefined)
            setAttempt((n) => n + 1)
          }}
        >
          {t('retry')}
        </button>
      </div>
    ) : unsupported ? (
      <div className={cls.cover} role="alert">
        {t('unsupported')}
      </div>
    ) : channel === 'open' && front === false ? (
      <div className={cls.cover}>
        {t('away')}
        <button type="button" onClick={show}>
          {t('show')}
        </button>
      </div>
    ) : waiting !== undefined ? (
      <div className={cls.cover} role="status">
        {t(waiting)}
      </div>
    ) : undefined

  return (
    <div className={cls.root}>
      <div ref={screen} className={cls.screen} aria-label={t('title')}>
        <textarea
          ref={box}
          className={cls.input}
          aria-label={t('title')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          rows={1}
        />
      </div>
      {cover}
      <div className={cls.notices}>
        {downloads.map((download) => (
          <div key={download.id} className={cls.notice} role="status">
            {t('downloaded')}: {download.name}
            <a href={apiUrl(DOWNLOAD_PATH, { id: download.id })} download={download.name}>
              {t('save')}
            </a>
            <button
              type="button"
              aria-label={t('dismiss')}
              onClick={() => setDownloads((list) => list.filter((d) => d.id !== download.id))}
            >
              ×
            </button>
          </div>
        ))}
        {upload !== undefined && (
          <div className={cls.notice} role="alert">
            {uploading === 'sending'
              ? t('uploading')
              : uploading === 'failed'
                ? t('uploadFailed')
                : t('uploadAsked')}
            <input
              ref={chooser}
              type="file"
              hidden
              multiple={upload.multiple}
              onChange={(event) => {
                sendFiles(event.currentTarget.files)
                event.currentTarget.value = ''
              }}
            />
            <button type="button" onClick={() => chooser.current?.click()}>
              {t('choose')}
            </button>
            <button type="button" onClick={() => send({ type: 'cancelUpload', id: upload.id })}>
              {t('cancel')}
            </button>
          </div>
        )}
        {blockedCopy !== undefined && (
          <div className={cls.notice} role="status">
            {t('copyBlocked')}
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(blockedCopy).then(
                  () => setBlockedCopy(undefined),
                  () => {},
                )
              }}
            >
              {t('copy')}
            </button>
            <button
              type="button"
              aria-label={t('dismiss')}
              onClick={() => setBlockedCopy(undefined)}
            >
              ×
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function GuideIcon({ className }: IconProps): JSX.Element {
  return (
    <span className={[cls.guideIcon, className].filter(Boolean).join(' ')}>
      <IconGlobeOutlineRegular size={18} />
    </span>
  )
}

export function BrowserTitle({ t }: { readonly t: T }): JSX.Element {
  return (
    <span className={cls.title}>
      <IconGlobeOutlineRegular size={16} />
      {t('title')}
    </span>
  )
}

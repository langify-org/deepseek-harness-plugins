// The one browser every conversation shares: Xvnc and Chromium, started on
// first use and stopped once nothing has used them for a while. Each Browser
// tab owns one Chromium window. The window of the tab shown last is the one on
// the screen, sized to that tab. The model's tools act on windows too: its
// conversation's window used last, or a new one, which the next Browser tab
// the conversation opens takes over.
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import type { ServerMessage, Size } from '../protocol.ts'
import { Cdp, type CdpEvent } from './cdp.ts'
import { startChromium, type RunningChromium } from './chromium.ts'
import { startDisplay, type Display } from './display.ts'
import { messageOf } from './errors.ts'
import { safeFileName, uniqueFileName } from './files.ts'

export interface BrowserOptions {
  readonly subprocess: SubprocessRuntime
  readonly xvnc: string
  readonly chromium: string
  readonly flags: readonly string[]
  readonly language: string
  /** The profile, downloads and uploads. */
  readonly stateDir: string
  /** A directory only this user can enter, for the VNC socket. */
  readonly runtimeDir: string
  readonly warn: (message: string) => void
}

/** One Chromium window, owned by a Browser tab or made for the model. */
export interface BrowserWindow {
  /** The owning tab's key, or a key of the model's own for a window no tab shows yet. */
  key: string
  readonly session: string
  readonly windowId: number
  /** Whether a Browser tab owns it; a window made for the model waits for one. */
  tab: boolean
  lastUsed: number
}

/** A Chromium tab, attached so commands can reach it. */
export interface Page {
  readonly targetId: string
  /** The flat-mode session commands to this page use. */
  readonly sessionId: string
  readonly title: string
  readonly url: string
}

/** A finished download, kept until the browser next starts. */
export interface Download {
  readonly id: string
  readonly name: string
  readonly path: string
  readonly size: number
}

/** Where a tab hears about its window. */
export interface Channel {
  send(message: ServerMessage): void
}

/** A file chooser a page opened, waiting for files from the user. */
interface Upload {
  readonly id: string
  readonly key: string
  readonly sessionId: string
  readonly backendNodeId: number
  readonly multiple: boolean
}

interface Running {
  readonly display: Display
  readonly chromium: RunningChromium
  readonly cdp: Cdp
}

interface PageState {
  sessionId: string | undefined
  title: string
  url: string
}

/** The screen before any tab has asked for a size. */
const FIRST_SIZE: Size = { width: 1280, height: 800 }
/** How long after a resize the window is fitted again, once the screen has followed the tab. */
const REFIT_MS = 600

const targetInfo = z.object({
  targetId: z.string(),
  type: z.string(),
  title: z.string().catch(''),
  url: z.string().catch(''),
})
const created = z.object({ targetId: z.string() })
const windowForTarget = z.object({ windowId: z.number() })
const attachedResult = z.object({ sessionId: z.string() })
const attachedEvent = z.object({ sessionId: z.string(), targetInfo })
const targetEvent = z.object({ targetInfo })
const destroyedEvent = z.object({ targetId: z.string() })
const detachedEvent = z.object({ sessionId: z.string() })
const downloadBegin = z.object({
  guid: z.string().regex(/^[0-9a-f-]{36}$/),
  suggestedFilename: z.string(),
  frameId: z.string(),
})
const downloadProgress = z.object({
  guid: z.string(),
  state: z.string(),
  receivedBytes: z.number(),
})
const fileChooser = z.object({ mode: z.string(), backendNodeId: z.number().optional() })
const evaluated = z.object({
  result: z.object({
    type: z.string(),
    value: z.unknown().optional(),
    description: z.string().optional(),
  }),
  exceptionDetails: z
    .object({
      text: z.string(),
      exception: z.object({ description: z.string().optional() }).optional(),
    })
    .optional(),
})

/** What a page evaluation produced: its JSON value, or a description of what cannot be JSON. */
export interface Evaluation {
  readonly value: unknown
  readonly description: string | undefined
}

export class SharedBrowser {
  readonly #options: BrowserOptions
  #starting: Promise<Running> | undefined
  #running: Running | undefined
  readonly #windows = new Map<string, BrowserWindow>()
  readonly #creating = new Map<string, Promise<BrowserWindow>>()
  readonly #pages = new Map<string, PageState>()
  readonly #channels = new Map<string, Set<Channel>>()
  readonly #begun = new Map<string, { name: string; frameId: string }>()
  readonly #downloads = new Map<string, Download>()
  readonly #uploads = new Map<string, Upload>()
  #front: string | undefined
  /** The size of the tab on the screen. */
  #frontSize: Size = FIRST_SIZE
  /** Shows run one at a time, so the window on top is the one the tabs are told about. */
  #showing: Promise<void> = Promise.resolve()
  #connections = 0
  #lastActivity = Date.now()
  #modelWindows = 0
  #disposed = false

  constructor(options: BrowserOptions) {
    this.#options = options
  }

  /** Where Chromium saves downloads: one folder per download, named by its id. */
  get downloadsDir(): string {
    return join(this.#options.stateDir, 'downloads')
  }

  get #uploadsDir(): string {
    return join(this.#options.stateDir, 'uploads')
  }

  /** The VNC socket, starting the browser if it is not running. */
  async vncSocket(): Promise<string> {
    return (await this.#ensure()).display.socketPath
  }

  /** Note use of the browser, which postpones stopping it for being idle. */
  touch(): void {
    this.#lastActivity = Date.now()
  }

  /** Count an open VNC stream or control channel, which keeps the browser running; returns the release. */
  connect(): () => void {
    this.#connections += 1
    this.touch()
    let released = false
    return () => {
      if (released) return
      released = true
      this.#connections -= 1
      this.touch()
    }
  }

  /** Stop the browser if nothing is connected and nothing used it for `idleMs`. */
  stopIfIdle(idleMs: number): void {
    if (this.#running === undefined || this.#connections > 0) return
    if (Date.now() - this.#lastActivity < idleMs) return
    this.stop().catch((error: unknown) => this.#options.warn(`stopping: ${messageOf(error)}`))
  }

  async stop(): Promise<void> {
    const running = await this.#starting?.catch(() => undefined)
    if (running === undefined) return
    running.cdp.close()
    running.chromium.process.terminate()
    await running.chromium.process.waitForExit()
    running.display.process.terminate()
    await running.display.process.waitForExit()
    this.#ended(running)
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    await this.stop()
  }

  // ---- Tabs ----

  /**
   * Let a tab hear about its window. It hears whether the window is on the
   * screen once the show it asks for has run, and whenever that changes.
   */
  addChannel(key: string, channel: Channel): () => void {
    let channels = this.#channels.get(key)
    if (channels === undefined) {
      channels = new Set()
      this.#channels.set(key, channels)
    }
    channels.add(channel)
    for (const upload of this.#uploads.values()) {
      if (upload.key === key) {
        channel.send({ type: 'upload', id: upload.id, multiple: upload.multiple })
      }
    }
    return () => {
      channels.delete(channel)
      if (channels.size === 0) this.#channels.delete(key)
    }
  }

  /** Put a tab's window on the screen at the tab's size, making the window if it has none. */
  show(key: string, session: string, size: Size): Promise<void> {
    const showing = this.#showing.then(() => this.#show(key, session, size))
    this.#showing = showing.catch(() => {})
    return showing
  }

  async #show(key: string, session: string, size: Size): Promise<void> {
    const window = await this.#window(key, session)
    const { cdp } = await this.#ensure()
    const page = await this.activePage(window)
    await cdp.send('Target.activateTarget', { targetId: page.targetId })
    await this.#fit(window, size)
    window.lastUsed = Date.now()
    this.#front = key
    this.#frontSize = size
    this.#announceFront()
    // The tab resizes the screen over VNC at the same time; fit again once it has.
    setTimeout(() => {
      if (this.#front === key && this.#windows.get(key) === window) {
        this.#fit(window, size).catch(() => {})
      }
    }, REFIT_MS)
  }

  /** Fit the window on the screen to its tab's new size. */
  async resize(key: string, size: Size): Promise<void> {
    const window = this.#windows.get(key)
    if (window === undefined || this.#front !== key) return
    this.#frontSize = size
    await this.#fit(window, size)
  }

  /** Type text the user's input method committed into the window's current page. */
  async typeText(key: string, text: string): Promise<void> {
    const window = this.#windows.get(key)
    if (window === undefined) return
    const { cdp } = await this.#ensure()
    const page = await this.activePage(window)
    await cdp.send('Input.insertText', { text }, page.sessionId)
  }

  /** Close a tab's window. */
  async closeWindow(key: string): Promise<void> {
    const window = this.#windows.get(key)
    if (window === undefined) return
    this.#windows.delete(key)
    // Deleting the entry being visited is safe while iterating a Map.
    for (const upload of this.#uploads.values()) {
      if (upload.key === key) this.cancelUpload(upload.id)
    }
    if (this.#front === key) this.#front = undefined
    const running = this.#running
    if (running === undefined) return
    for (const page of await this.#pagesIn(window.windowId)) {
      await running.cdp.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {})
    }
  }

  /** Close every window of a conversation. */
  async closeSession(session: string): Promise<void> {
    for (const window of this.#windows.values()) {
      if (window.session === session) await this.closeWindow(window.key)
    }
  }

  // ---- The model's tools ----

  /** A conversation's open windows, the one used last first. */
  async windowsOf(session: string): Promise<BrowserWindow[]> {
    const open: BrowserWindow[] = []
    for (const window of this.#windows.values()) {
      if (window.session === session && (await this.#isOpen(window))) open.push(window)
    }
    return open.toSorted((a, b) => b.lastUsed - a.lastUsed)
  }

  /** A new window for the model, which the conversation's next new Browser tab shows. */
  async newWindow(session: string): Promise<BrowserWindow> {
    this.#modelWindows += 1
    // A tab's key starts with a conversation id, which has no slash: no tab key looks like this.
    return this.#window(`model/${session}/${this.#modelWindows}`, session, false)
  }

  /** Whether the window is the one on the screen. */
  isFront(window: BrowserWindow): boolean {
    return this.#front === window.key
  }

  /** The pages of a window, in Chromium's order. */
  async pagesOf(window: BrowserWindow): Promise<Page[]> {
    return this.#pagesIn(window.windowId)
  }

  /** The page a window shows: the visible one among its tabs. */
  async activePage(window: BrowserWindow): Promise<Page> {
    const pages = await this.#pagesIn(window.windowId)
    const [first] = pages
    if (first === undefined) throw new Error('This browser window has closed.')
    if (pages.length === 1) return first
    const states = await Promise.all(
      pages.map((page) =>
        this.evaluate(page, 'document.visibilityState').then(
          (result) => result.value,
          () => undefined,
        ),
      ),
    )
    return pages[states.indexOf('visible')] ?? first
  }

  /** Mark a window as the one its conversation used last. */
  use(window: BrowserWindow): void {
    window.lastUsed = Date.now()
    this.touch()
  }

  /** Send a command to a page. */
  async send(page: Page, method: string, params: object = {}): Promise<unknown> {
    const { cdp } = await this.#ensure()
    return cdp.send(method, params, page.sessionId)
  }

  /** Evaluate an expression in a page, awaiting a promise it returns. */
  async evaluate(page: Page, expression: string): Promise<Evaluation> {
    const result = evaluated.parse(
      await this.send(page, 'Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }),
    )
    if (result.exceptionDetails !== undefined) {
      const { exception, text } = result.exceptionDetails
      throw new Error(exception?.description ?? text)
    }
    return { value: result.result.value, description: result.result.description }
  }

  // ---- Files ----

  download(id: string): Download | undefined {
    return this.#downloads.get(id)
  }

  /** Give a file chooser the user's files, then close it. */
  async completeUpload(
    id: string,
    files: readonly { readonly name: string; readonly data: Uint8Array }[],
  ): Promise<void> {
    const upload = this.#uploads.get(id)
    if (upload === undefined) throw new Error('This file chooser has closed.')
    const chosen = upload.multiple ? files : files.slice(0, 1)
    const dir = join(this.#uploadsDir, id)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const taken = new Set(await readdir(dir))
    const paths: string[] = []
    for (const file of chosen) {
      const name = uniqueFileName(safeFileName(file.name), taken)
      taken.add(name)
      const path = join(dir, name)
      await writeFile(path, file.data, { mode: 0o600 })
      paths.push(path)
    }
    const { cdp } = await this.#ensure()
    await cdp.send(
      'DOM.setFileInputFiles',
      { files: paths, backendNodeId: upload.backendNodeId },
      upload.sessionId,
    )
    this.#closeUpload(upload)
  }

  cancelUpload(id: string): void {
    const upload = this.#uploads.get(id)
    if (upload !== undefined) this.#closeUpload(upload)
  }

  // ---- Internals ----

  #ensure(): Promise<Running> {
    if (this.#disposed) return Promise.reject(new Error('The browser plugin has stopped.'))
    this.#starting ??= this.#start().catch((error: unknown) => {
      this.#starting = undefined
      throw error
    })
    return this.#starting
  }

  async #start(): Promise<Running> {
    const { subprocess, stateDir, runtimeDir } = this.#options
    // Downloads and uploads are handed over while the browser runs; nothing outlives it.
    this.#downloads.clear()
    await rm(this.downloadsDir, { recursive: true, force: true })
    await rm(this.#uploadsDir, { recursive: true, force: true })
    await mkdir(this.downloadsDir, { recursive: true, mode: 0o700 })
    const display = await startDisplay(
      subprocess,
      this.#options.xvnc,
      join(runtimeDir, 'vnc.sock'),
      FIRST_SIZE,
    )
    let chromium: RunningChromium
    let cdp: Cdp
    try {
      chromium = await startChromium(subprocess, display.number, {
        command: this.#options.chromium,
        flags: this.#options.flags,
        language: this.#options.language,
        profileDir: join(stateDir, 'profile'),
      })
    } catch (error) {
      display.process.terminate()
      throw error
    }
    try {
      cdp = await Cdp.connect(chromium.url, 10_000)
    } catch (error) {
      chromium.process.terminate()
      display.process.terminate()
      throw error
    }
    const running: Running = { display, chromium, cdp }
    this.#running = running
    cdp.on((event) => this.#onEvent(running, event))
    // Any part ending ends the whole browser; the next use starts it again.
    const ended = (): void => {
      chromium.process.terminate()
      display.process.terminate()
      cdp.close()
      this.#ended(running)
    }
    void display.process.done.then(ended, ended)
    void chromium.process.done.then(ended, ended)
    void cdp.closed.then(ended)
    try {
      await cdp.send('Target.setDiscoverTargets', { discover: true })
      await cdp.send('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      })
      await cdp.send('Browser.setDownloadBehavior', {
        behavior: 'allowAndName',
        downloadPath: this.downloadsDir,
        eventsEnabled: true,
      })
    } catch (error) {
      ended()
      throw error
    }
    this.touch()
    return running
  }

  /** Forget a browser that has ended; its windows and choosers went with it. */
  #ended(running: Running): void {
    if (this.#running !== running) return
    this.#running = undefined
    this.#starting = undefined
    this.#windows.clear()
    this.#creating.clear()
    this.#pages.clear()
    this.#begun.clear()
    for (const upload of this.#uploads.values()) this.#closeUpload(upload)
    this.#front = undefined
    this.#announceFront()
  }

  /** The window of a tab, or of the model when `tab` is false, making one if it has none open. */
  async #window(key: string, session: string, tab = true): Promise<BrowserWindow> {
    await this.#ensure()
    const existing = this.#windows.get(key)
    if (existing !== undefined && (await this.#isOpen(existing))) return existing
    if (existing !== undefined) this.#windows.delete(key)
    // A tab opened after the model made a window in its conversation shows that window.
    if (tab) {
      for (const window of this.#windows.values()) {
        if (window.session !== session || window.tab || !(await this.#isOpen(window))) continue
        this.#windows.delete(window.key)
        window.key = key
        window.tab = true
        this.#windows.set(key, window)
        return window
      }
    }
    let creating = this.#creating.get(key)
    if (creating === undefined) {
      creating = this.#createWindow(key, session, tab).finally(() => this.#creating.delete(key))
      this.#creating.set(key, creating)
    }
    return creating
  }

  async #createWindow(key: string, session: string, tab: boolean): Promise<BrowserWindow> {
    const { cdp } = await this.#ensure()
    const { targetId } = created.parse(
      await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true }),
    )
    const { windowId } = windowForTarget.parse(
      await cdp.send('Browser.getWindowForTarget', { targetId }),
    )
    const window: BrowserWindow = { key, session, windowId, tab, lastUsed: Date.now() }
    this.#windows.set(key, window)
    return window
  }

  async #isOpen(window: BrowserWindow): Promise<boolean> {
    return (await this.#pagesIn(window.windowId)).length > 0
  }

  /** The pages in a window now: tabs move between windows, so each is asked where it is. */
  async #pagesIn(windowId: number): Promise<Page[]> {
    const running = this.#running
    if (running === undefined) return []
    const found = await Promise.all(
      [...this.#pages].map(async ([targetId, state]): Promise<Page | undefined> => {
        const where = windowForTarget.safeParse(
          await running.cdp.send('Browser.getWindowForTarget', { targetId }).catch(() => ({})),
        )
        if (!where.success || where.data.windowId !== windowId) return undefined
        const sessionId = state.sessionId ?? (await this.#attach(running, targetId, state))
        return sessionId === undefined
          ? undefined
          : { targetId, sessionId, title: state.title, url: state.url }
      }),
    )
    return found.filter((page) => page !== undefined)
  }

  /** Attach to a page the automatic attachment has not reached yet. */
  async #attach(running: Running, targetId: string, state: PageState): Promise<string | undefined> {
    const result = attachedResult.safeParse(
      await running.cdp
        .send('Target.attachToTarget', { targetId, flatten: true })
        .catch(() => ({})),
    )
    if (!result.success) return undefined
    state.sessionId = result.data.sessionId
    await this.#prepare(running, result.data.sessionId)
    return result.data.sessionId
  }

  /** Have a page hand its file choosers to the plugin instead of the desktop's dialog. */
  async #prepare(running: Running, sessionId: string): Promise<void> {
    await running.cdp.send('Page.enable', {}, sessionId).catch(() => {})
    await running.cdp
      .send('Page.setInterceptFileChooserDialog', { enabled: true }, sessionId)
      .catch(() => {})
  }

  async #fit(window: BrowserWindow, size: Size): Promise<void> {
    const { cdp } = await this.#ensure()
    // Bounds apply to a normal window only.
    await cdp
      .send('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: { windowState: 'normal' },
      })
      .catch(() => {})
    await cdp.send('Browser.setWindowBounds', {
      windowId: window.windowId,
      bounds: { left: 0, top: 0, width: size.width, height: size.height },
    })
  }

  #announceFront(): void {
    for (const [key, channels] of this.#channels) {
      for (const channel of channels) channel.send({ type: 'front', front: this.#front === key })
    }
  }

  /** Tell a window's tabs, or when none is listening the tabs of the window on the screen. */
  #tell(key: string | undefined, message: ServerMessage): void {
    const channels =
      (key === undefined ? undefined : this.#channels.get(key)) ??
      (this.#front === undefined ? undefined : this.#channels.get(this.#front))
    for (const channel of channels ?? []) channel.send(message)
  }

  #closeUpload(upload: Upload): void {
    this.#uploads.delete(upload.id)
    this.#tell(upload.key, { type: 'uploadClosed', id: upload.id })
    // The files stay: the page reads them from disk whenever it likes. The next start clears them.
  }

  /** The key of the window a page is in. */
  async #keyOfTarget(targetId: string): Promise<string | undefined> {
    const running = this.#running
    if (running === undefined) return undefined
    const where = windowForTarget.safeParse(
      await running.cdp.send('Browser.getWindowForTarget', { targetId }).catch(() => ({})),
    )
    if (!where.success) return undefined
    for (const window of this.#windows.values()) {
      if (window.windowId === where.data.windowId) return window.key
    }
    return undefined
  }

  #onEvent(running: Running, event: CdpEvent): void {
    const handle = async (): Promise<void> => {
      switch (event.method) {
        case 'Target.attachedToTarget': {
          const { sessionId, targetInfo: info } = attachedEvent.parse(event.params)
          if (info.type !== 'page') {
            // Workers and the like: nothing here drives them.
            await running.cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {})
            return
          }
          const state = this.#pages.get(info.targetId)
          if (state === undefined) {
            this.#pages.set(info.targetId, { sessionId, title: info.title, url: info.url })
          } else state.sessionId = sessionId
          await this.#prepare(running, sessionId)
          return
        }
        case 'Target.targetCreated':
        case 'Target.targetInfoChanged': {
          const { targetInfo: info } = targetEvent.parse(event.params)
          if (info.type !== 'page') return
          const state = this.#pages.get(info.targetId)
          if (state === undefined) {
            this.#pages.set(info.targetId, {
              sessionId: undefined,
              title: info.title,
              url: info.url,
            })
          } else {
            state.title = info.title
            state.url = info.url
          }
          return
        }
        case 'Target.targetDestroyed': {
          this.#pages.delete(destroyedEvent.parse(event.params).targetId)
          // The user closed the last Chromium tab of the window on the screen: its
          // Browser tab gets a new window, rather than showing the one beneath.
          const key = this.#front
          const window = key === undefined ? undefined : this.#windows.get(key)
          if (key !== undefined && window !== undefined && !(await this.#isOpen(window))) {
            await this.show(key, window.session, this.#frontSize)
          }
          return
        }
        case 'Target.detachedFromTarget': {
          const { sessionId } = detachedEvent.parse(event.params)
          for (const state of this.#pages.values()) {
            if (state.sessionId === sessionId) state.sessionId = undefined
          }
          return
        }
        case 'Browser.downloadWillBegin': {
          const { guid, suggestedFilename, frameId } = downloadBegin.parse(event.params)
          this.#begun.set(guid, { name: safeFileName(suggestedFilename, 'download'), frameId })
          return
        }
        case 'Browser.downloadProgress': {
          const { guid, state, receivedBytes } = downloadProgress.parse(event.params)
          const begun = this.#begun.get(guid)
          if (begun === undefined || (state !== 'completed' && state !== 'canceled')) return
          this.#begun.delete(guid)
          if (state === 'canceled') return
          // Chromium saved it as <guid>: give it its own folder and its name back.
          const dir = join(this.downloadsDir, guid)
          const temporary = `${dir}.part`
          await rename(dir, temporary)
          await mkdir(dir, { mode: 0o700 })
          const path = join(dir, begun.name)
          await rename(temporary, path)
          // A page's main frame has the page's own id.
          const key = await this.#keyOfTarget(begun.frameId)
          this.#downloads.set(guid, { id: guid, name: begun.name, path, size: receivedBytes })
          this.#tell(key, { type: 'download', id: guid, name: begun.name, size: receivedBytes })
          return
        }
        case 'Page.fileChooserOpened': {
          const { mode, backendNodeId } = fileChooser.parse(event.params)
          const sessionId = event.sessionId
          // Without the input element there is nothing to give files to.
          if (sessionId === undefined || backendNodeId === undefined) return
          const targetId = this.#pages.entries().find(([, s]) => s.sessionId === sessionId)?.[0]
          // A popup's window belongs to no tab: the tab on the screen answers, as for downloads.
          const key =
            (targetId === undefined ? undefined : await this.#keyOfTarget(targetId)) ?? this.#front
          if (key === undefined) return
          const upload: Upload = {
            id: randomUUID(),
            key,
            sessionId,
            backendNodeId,
            multiple: mode === 'selectMultiple',
          }
          this.#uploads.set(upload.id, upload)
          this.#tell(key, { type: 'upload', id: upload.id, multiple: upload.multiple })
        }
      }
    }
    handle().catch((error: unknown) => this.#options.warn(`${event.method}: ${messageOf(error)}`))
  }
}

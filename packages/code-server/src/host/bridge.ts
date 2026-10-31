// Connects each editor window's extension host to the page that created it.
// A binding is created per iframe, handed to the window through its URL, and
// claimed once by the extension over a private Unix socket.
import { randomUUID } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { createServer, type Server, type Socket } from 'node:net'
import {
  editorFrameSchema,
  frame,
  helloSchema,
  readFrames,
  type HostFrame,
  type OpenRequest,
} from '../bridge-protocol.ts'
import type { BindingState, ErrorCode, FileLocation, Responses } from '../rpc.ts'
import { CodeServerError } from './errors.ts'

/** An unclaimed binding expires this long after creation. */
export const CONNECT_TIMEOUT_MS = 60_000
/** A binding expires this long after the page last watched it. */
export const LEASE_MS = 120_000
/** An open request without an answer by then has an unknown outcome. */
export const OPEN_TIMEOUT_MS = 15_000
/** The longest a watch waits for a change. */
export const WATCH_MS = 20_000
const HELLO_TIMEOUT_MS = 5_000

type FinalState = Exclude<BindingState, 'pending' | 'ready'>

interface PendingOpen {
  readonly resolve: (location: FileLocation) => void
  readonly reject: (error: CodeServerError) => void
  readonly timer: NodeJS.Timeout
}

interface Binding {
  readonly id: string
  readonly sessionId: string
  readonly ownerId: string
  readonly cwd: string
  readonly connectBy: number
  state: BindingState
  /** Counts the changes a watching page has not seen: state and reconnect requests. */
  revision: number
  reconnect: boolean
  /** The last working folder the editor was told about. */
  announcedCwd: string
  leaseUntil: number
  timer?: NodeJS.Timeout
  peer?: Socket
  readonly opens: Map<string, PendingOpen>
  readonly watchers: Set<() => void>
}

const finalError: Record<FinalState, ErrorCode> = {
  disconnected: 'binding_disconnected',
  expired: 'binding_expired',
  closed: 'binding_closed',
}

export class Bridge {
  readonly #bindings = new Map<string, Binding>()
  readonly #sockets = new Set<Socket>()
  readonly #server: Server
  /** Where extensions connect; every code-server window learns it from its environment. */
  readonly socketPath: string

  private constructor(server: Server, socketPath: string) {
    this.#server = server
    this.socketPath = socketPath
    server.on('connection', (socket) => this.#accept(socket))
  }

  /** Listen on `socketPath`, which must sit in a directory only this user can enter. */
  static async listen(socketPath: string): Promise<Bridge> {
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, () => {
        server.off('error', reject)
        resolve()
      })
    })
    await chmod(socketPath, 0o600)
    return new Bridge(server, socketPath)
  }

  /**
   * Start a binding for a window that will open `cwd`, a canonical path the
   * extension must match, and return its id.
   */
  create(sessionId: string, ownerId: string, cwd: string): string {
    for (const binding of this.#bindings.values()) {
      if (binding.sessionId === sessionId && binding.ownerId === ownerId)
        this.#finish(binding, 'closed')
    }
    const now = Date.now()
    const binding: Binding = {
      id: randomUUID(),
      sessionId,
      ownerId,
      cwd,
      connectBy: now + CONNECT_TIMEOUT_MS,
      state: 'pending',
      revision: 0,
      reconnect: false,
      announcedCwd: cwd,
      leaseUntil: now + LEASE_MS,
      opens: new Map(),
      watchers: new Set(),
    }
    this.#bindings.set(binding.id, binding)
    this.#schedule(binding)
    return binding.id
  }

  /**
   * Extend a live binding's lease, then wait until its revision differs from
   * `revision` or {@link WATCH_MS} passes, and report it.
   */
  async watch(
    sessionId: string,
    bindingId: string,
    revision: number,
    signal: AbortSignal,
  ): Promise<Responses['watch']> {
    const binding = this.#get(sessionId, bindingId)
    if (binding.state === 'pending' || binding.state === 'ready') {
      binding.leaseUntil = Date.now() + LEASE_MS
      this.#schedule(binding)
    }
    if (binding.revision === revision) {
      await new Promise<void>((resolve) => {
        const done = (): void => {
          clearTimeout(timer)
          binding.watchers.delete(done)
          signal.removeEventListener('abort', done)
          resolve()
        }
        const timer = setTimeout(done, WATCH_MS)
        binding.watchers.add(done)
        signal.addEventListener('abort', done, { once: true })
      })
    }
    return { state: binding.state, revision: binding.revision, reconnect: binding.reconnect }
  }

  close(sessionId: string, bindingId: string): void {
    const binding = this.#bindings.get(bindingId)
    if (binding?.sessionId === sessionId) this.#finish(binding, 'closed')
  }

  /** Tell a connected editor that the session's working folder is now `cwd`, once per new folder. */
  announceCwd(sessionId: string, bindingId: string, cwd: string): void {
    const binding = this.#get(sessionId, bindingId)
    if (cwd === binding.announcedCwd) return
    binding.announcedCwd = cwd
    // Moving back to the window's own folder needs no action.
    if (cwd !== binding.cwd) this.#send(binding, { type: 'cwd-changed', cwd })
  }

  /** Show a failure the host found for this window in its editor, when it is connected. */
  report(sessionId: string, bindingId: string, error: CodeServerError): void {
    const binding = this.#bindings.get(bindingId)
    if (binding?.sessionId !== sessionId) return
    this.#send(binding, { type: 'notice', code: error.code, message: error.message })
  }

  /**
   * Ask the window to show a file. Never retried: a lost answer is
   * `outcome_unknown`. The editor reports its own failures; a timeout found
   * here is reported to it too.
   */
  open(sessionId: string, bindingId: string, location: FileLocation): Promise<FileLocation> {
    const binding = this.#get(sessionId, bindingId)
    const peer = binding.peer
    if (binding.state === 'pending' || peer === undefined) {
      throw new CodeServerError('not_ready', 'The editor window has not connected yet')
    }
    if (binding.state !== 'ready') {
      throw new CodeServerError(finalError[binding.state], `The binding is ${binding.state}`)
    }
    const requestId = randomUUID()
    const request: OpenRequest = {
      type: 'open',
      requestId,
      ...location,
      deadline: Date.now() + OPEN_TIMEOUT_MS,
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        binding.opens.delete(requestId)
        const error = new CodeServerError('outcome_unknown', 'No answer from the editor window')
        this.#send(binding, { type: 'notice', code: error.code, message: error.message })
        reject(error)
      }, OPEN_TIMEOUT_MS)
      binding.opens.set(requestId, { resolve, reject, timer })
      peer.write(frame(request))
    })
  }

  async dispose(): Promise<void> {
    for (const binding of this.#bindings.values()) {
      this.#finish(binding, 'closed')
      clearTimeout(binding.timer)
    }
    this.#bindings.clear()
    const closed = new Promise<void>((resolve) => this.#server.close(() => resolve()))
    for (const socket of this.#sockets) socket.destroy()
    await closed
  }

  #get(sessionId: string, bindingId: string): Binding {
    const binding = this.#bindings.get(bindingId)
    if (binding?.sessionId !== sessionId) {
      throw new CodeServerError('unknown_binding', 'No such binding for this session')
    }
    return binding
  }

  #send(binding: Binding, message: HostFrame): void {
    if (binding.state === 'ready') binding.peer?.write(frame(message))
  }

  /** Wake the page's watch. */
  #changed(binding: Binding): void {
    binding.revision += 1
    for (const wake of binding.watchers) wake()
  }

  /** Arm the binding's single timer for its next deadline. */
  #schedule(binding: Binding): void {
    clearTimeout(binding.timer)
    const deadline =
      binding.state === 'pending'
        ? Math.min(binding.connectBy, binding.leaseUntil)
        : binding.leaseUntil
    binding.timer = setTimeout(() => this.#finish(binding, 'expired'), deadline - Date.now())
  }

  /** Enter a final state once; the record stays for a lease so watches can read it. */
  #finish(binding: Binding, state: FinalState): void {
    if (binding.state !== 'pending' && binding.state !== 'ready') return
    binding.state = state
    binding.peer?.destroy()
    for (const open of binding.opens.values()) {
      clearTimeout(open.timer)
      open.reject(
        new CodeServerError(
          'outcome_unknown',
          `The binding was ${state} before the editor answered`,
        ),
      )
    }
    binding.opens.clear()
    clearTimeout(binding.timer)
    binding.timer = setTimeout(() => this.#bindings.delete(binding.id), LEASE_MS)
    this.#changed(binding)
  }

  #accept(socket: Socket): void {
    let binding: Binding | undefined
    let refused = false
    const helloTimer = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS)
    // A refused connection is done: it cannot try another binding.
    const reject = (code: string, message: string): void => {
      refused = true
      socket.end(frame({ type: 'rejected', code, message }))
    }
    this.#sockets.add(socket)
    socket.on('error', () => socket.destroy())
    socket.on('close', () => {
      this.#sockets.delete(socket)
      clearTimeout(helloTimer)
      if (binding?.peer === socket) this.#finish(binding, 'disconnected')
    })
    readFrames(
      socket,
      (value) => {
        if (refused) return
        if (binding === undefined) {
          clearTimeout(helloTimer)
          const hello = helloSchema.safeParse(value)
          if (!hello.success) return reject('invalid_hello', 'Expected a hello frame')
          const candidate = this.#bindings.get(hello.data.bindingId)
          if (candidate?.state !== 'pending')
            return reject('binding_unavailable', 'The binding cannot be claimed')
          if (candidate.cwd !== hello.data.cwd)
            return reject('cwd_mismatch', 'The window opened another folder')
          binding = candidate
          binding.peer = socket
          binding.state = 'ready'
          this.#schedule(binding)
          socket.write(frame({ type: 'accepted', bindingId: binding.id }))
          this.#changed(binding)
          return
        }
        const message = editorFrameSchema.safeParse(value)
        if (!message.success) return void socket.destroy()
        if (message.data.type === 'reconnect') {
          binding.reconnect = true
          this.#changed(binding)
          return
        }
        const result = message.data
        const open = binding.opens.get(result.requestId)
        if (open === undefined) return // answered after its timeout: already reported as unknown
        binding.opens.delete(result.requestId)
        clearTimeout(open.timer)
        if (result.ok) open.resolve({ path: result.path, line: result.line })
        else open.reject(new CodeServerError(result.error.code, result.error.message))
      },
      () => socket.destroy(),
    )
  }
}

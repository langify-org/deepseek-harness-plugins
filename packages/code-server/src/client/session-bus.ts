import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { BindingState } from '../rpc.ts'
import type { MessageKey } from '../messages.ts'

/** The page's view of its connection: `idle` until a Code tab owns it, `error` after a failed call. */
export type Phase = 'idle' | 'error' | BindingState

/** After these the page must reconnect; files are never sent to another window. */
export const FINAL_PHASES: ReadonlySet<Phase> = new Set<Phase>(['expired', 'closed', 'error'])

export interface Notice {
  readonly key: MessageKey
  readonly params?: Readonly<Record<string, string | number>>
}

/** A file link waiting for the editor to become ready. */
export interface FileRequest {
  readonly address: string
  readonly line: number | undefined
}

export interface BusState {
  readonly phase: Phase
  readonly queue: readonly (FileRequest & { readonly expiresAt: number })[]
  readonly notice: Notice | undefined
  /** The session's Code tab. */
  readonly owner: TabId | undefined
}

const QUEUE_LIMIT = 16
const QUEUE_TTL_MS = 60_000
const SEEN_LIMIT = 256

/** One session's Code page state, shared by its Code tab and its file-link tabs. */
export class SessionBus {
  #state: BusState = { phase: 'idle', queue: [], notice: undefined, owner: undefined }
  readonly #listeners = new Set<() => void>()
  /** Navigation keys already queued, so a re-rendered link is not opened twice. */
  readonly #seen = new Set<string>()
  readonly #now: () => number

  constructor(now: () => number = Date.now) {
    this.#now = now
  }

  readonly getSnapshot = (): BusState => this.#state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Make `tabId` the Code page, or return the tab that already is. */
  claim(tabId: TabId): TabId | undefined {
    if (this.#state.owner !== undefined && this.#state.owner !== tabId) return this.#state.owner
    if (this.#state.owner === undefined) this.#update({ owner: tabId })
    return undefined
  }

  release(tabId: TabId): void {
    if (this.#state.owner !== tabId) return
    this.#update({ owner: undefined, phase: 'idle', queue: [], notice: undefined })
  }

  /** Queue a file once per `key` until the editor is ready. */
  enqueue(key: string, request: FileRequest): void {
    if (this.#seen.has(key)) return
    this.#seen.add(key)
    if (this.#seen.size > SEEN_LIMIT) this.#seen.delete(this.#seen.values().next().value ?? key)
    if (FINAL_PHASES.has(this.#state.phase)) return this.#update({ notice: { key: 'queue.ended' } })
    if (this.#state.queue.length >= QUEUE_LIMIT)
      return this.#update({ notice: { key: 'queue.full' } })
    this.#update({
      queue: [...this.#state.queue, { ...request, expiresAt: this.#now() + QUEUE_TTL_MS }],
    })
  }

  /** The next queued file that has not waited too long. */
  take(): FileRequest | undefined {
    for (let [next, ...rest] = this.#state.queue; next !== undefined; [next, ...rest] = rest) {
      this.#update({ queue: rest })
      if (next.expiresAt >= this.#now()) return { address: next.address, line: next.line }
      this.#update({ notice: { key: 'queue.expired' } })
    }
    return undefined
  }

  phase(phase: Phase): void {
    this.#update(FINAL_PHASES.has(phase) ? { phase, queue: [] } : { phase })
  }

  notice(notice: Notice | undefined): void {
    this.#update({ notice })
  }

  clear(): void {
    this.#update({ queue: [] })
  }

  #update(change: Partial<BusState>): void {
    this.#state = { ...this.#state, ...change }
    for (const listener of this.#listeners) listener()
  }
}

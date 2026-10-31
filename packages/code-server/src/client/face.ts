import type { Context } from '@deepseek-ai/cordis'
import type { SidebarRightOpenTab, TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import {
  RPC_CHANNEL,
  RPC_PREFIX,
  responseSchemas,
  type Method,
  type Requests,
  type Responses,
} from '../rpc.ts'
import { SessionBus } from './session-bus.ts'

/** Tab kind of the Code page. */
export const CODE_KIND = 'langify-code-server'

const RPC_TIMEOUT_MS = 25_000

/** A failed call; `code` is one of the host's error codes unless DSH's transport failed first. */
export class RpcFailure extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** What the Code tab and the file-link tabs of one session share. */
export interface Face {
  readonly bus: SessionBus
  /** Whether the right sidebar shows this session now. */
  readonly isCurrent: () => boolean
  /** The session's open Code tab. */
  readonly findCode: () => SidebarRightOpenTab | undefined
  /** Expand the sidebar and focus one of this session's tabs. */
  readonly reveal: (tabId: TabId) => void
  readonly call: <M extends Method>(
    method: M,
    request: Omit<Requests[M], 'sessionId'>,
  ) => Promise<Responses[M]>
}

export function createFace(ctx: Context, sessionId: string): Face {
  const isCurrent = (): boolean => ctx.sidebarRight.mounted.getSnapshot() === sessionId
  return {
    bus: new SessionBus(),
    isCurrent,
    findCode: () =>
      ctx.sidebarRight.openTabs
        .getSnapshot()
        .find((tab) => tab.sessionId === sessionId && tab.kind === CODE_KIND),
    reveal: (tabId) => {
      if (!isCurrent()) return
      if (!ctx.sidebarRight.isExpanded()) ctx.sidebarRight.toggleExpanded()
      ctx.sidebarRight.focus(tabId)
    },
    async call(method, request) {
      const result = await ctx.connection.rpc.call(
        RPC_CHANNEL,
        `${RPC_PREFIX}${method}`,
        { ...request, sessionId },
        AbortSignal.timeout(RPC_TIMEOUT_MS),
      )
      if (!result.ok) throw new RpcFailure(result.error.code, result.error.message)
      return responseSchemas[method].parse(result.value)
    },
  }
}

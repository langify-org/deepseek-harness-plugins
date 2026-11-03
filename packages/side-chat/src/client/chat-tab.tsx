import { useEffect, useState, type JSX, type ReactNode } from 'react'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  PropsRenderFactories,
  SessionProviderComponent,
} from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'

/** Resource-address prefix of a side chat in the right sidebar. */
export const ADDRESS_PREFIX = 'dsh-resource://langify-side-chat/session/'

export function chatAddress(sessionId: string): string {
  return `${ADDRESS_PREFIX}${encodeURIComponent(sessionId)}`
}

/** The session id a side-chat address names, or undefined for any other address. */
export function parseChatAddress(address: string): SessionId | undefined {
  if (!address.startsWith(ADDRESS_PREFIX)) return undefined
  const rest = address.slice(ADDRESS_PREFIX.length)
  if (rest === '' || rest.includes('/')) return undefined
  try {
    return SessionId(decodeURIComponent(rest))
  } catch {
    return undefined
  }
}

export interface ChatTabFace {
  /** Hold the side chat's session for as long as the tab shows it. */
  readonly retain: (sessionId: SessionId) => SessionReference
}

export interface ChatTabProps extends ChatTabFace {
  readonly useTabInfo: UseSidebarRightTabInfo
  readonly SessionProvider: SessionProviderComponent
  readonly renderSlot: (key: typeof CONVERSATION_SLOT, owner: object) => ReactNode
}

/** The Session-scoped child slot inside the tab; its one entry is ConversationPanel. */
export const CONVERSATION_SLOT = 'langify-side-chat.conversation'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'langify-side-chat.conversation': { kind: 'single'; scope: 'session' }
  }
}

/**
 * The side chat's tab: binds the fork's Session around the conversation slot.
 */
export function ChatTab({
  retain,
  useTabInfo,
  SessionProvider,
  renderSlot,
}: ChatTabProps): JSX.Element | null {
  const { tab } = useTabInfo()
  const sessionId = parseChatAddress(tab.contentId)
  const [reference, setReference] = useState<SessionReference>()
  useEffect(() => {
    if (sessionId === undefined) return undefined
    const held = retain(sessionId)
    setReference(held)
    return () => {
      setReference(undefined)
      held.release()
    }
  }, [retain, sessionId])
  if (reference === undefined) return null
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <SessionProvider session={reference}>{renderSlot(CONVERSATION_SLOT, {})}</SessionProvider>
    </div>
  )
}

/**
 * DSH's shared conversation and composer for the surrounding Session, embedded
 * as DSH's subagent tab embeds it: Chat view only, without the main header and
 * width controls.
 */
export function ConversationPanel({ renderFactorySlot }: PropsRenderFactories): ReactNode {
  return renderFactorySlot(
    'conversation.content',
    { variant: 'embedded', phase: 'active', hero: false },
    { slots: { views: ChatView } },
  )
}

function ChatView({ renderSlot }: ConversationViewsProps): ReactNode {
  return renderSlot('conversation.session', { view: 'chat' })
}

// Browser half: a side-chat button on each assistant message forks the session
// and shows the fork in the right sidebar, with DSH's own chat and composer.
// Declarations of the injected services and of the slots this plugin fills.
/// <reference types="@deepseek-ai/dsh-api-session-controller/client" />
/// <reference types="@deepseek-ai/dsh-client-locale/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-chat/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-conversation/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-renderer/client" />
import { useState, type JSX } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { IconNewChatOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TabId } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  ERROR_CODES,
  PROJECTION_KEY,
  RPC_CHANNEL,
  RPC_METHOD,
  createResponseSchema,
} from '../rpc.ts'
import {
  ADDRESS_PREFIX,
  CONVERSATION_SLOT,
  ChatTab,
  ConversationPanel,
  chatAddress,
  parseChatAddress,
  type ChatTabFace,
} from './chat-tab.tsx'
import { NAMESPACE, en, ja, zh } from './messages.ts'
import { StartPage } from './start-page.tsx'

// DSH 0.2 provides the browser connection without declaring it on Context.
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle
  }
}

// The part of @deepseek-ai/dsh-client-ui-workspace's service this plugin uses.
declare module '@deepseek-ai/cordis' {
  interface Context {
    uiWorkspace: { openSession(target: string): void }
  }
}

// Projected by this plugin's host half (see host/index.ts).
declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    langifySideChat: boolean
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A side chat shown in the right sidebar. */
    langifySideChat: unknown
  }
}

export const inject: readonly string[] = [
  'connection',
  'locale',
  'sessions',
  'slots',
  'sidebarRight',
  'sidebarRightTabs',
  'uiWorkspace',
]

const KIND = 'langify-side-chat'
const TAB_ID = 'langify-side-chat/chat'
const START_KIND = 'langify-side-chat-new'
const START_ID = 'langify-side-chat/new'
const RPC_TIMEOUT_MS = 60_000
const ACTION_CLASS = 'langify-side-chat-action'
// After the feedback buttons' styles, which the action row's buttons share.
const ACTION_CSS = `.${ACTION_CLASS}{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}.${ACTION_CLASS} svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}.${ACTION_CLASS}:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.${ACTION_CLASS}:disabled{cursor:default;opacity:.4}`

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh }), 'side-chat: dictionaries')
  // Shown where a Japanese language pack is installed; DSH itself ships English and Chinese.
  ctx.effect(() => ctx.locale.register(NAMESPACE, 'ja', ja), 'side-chat: Japanese dictionary')
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = ACTION_CSS
    document.head.append(style)
    return () => style.remove()
  }, 'side-chat: styles')

  const chatFace: ChatTabFace = {
    retain: (sessionId) => ctx.sessions.retain(sessionId, { source: 'langifySideChat' }),
  }
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        patterns: [`${ADDRESS_PREFIX}**`],
        canOpen: (address) => parseChatAddress(address) !== undefined,
        title: (address) => {
          const id = parseChatAddress(address)
          return (id && ctx.sessions.list.getSnapshot().byId[id]?.title) || t('title')
        },
        keepMounted: true,
      }),
    'side-chat: chat tab type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            inject: () => chatFace,
            children: { [CONVERSATION_SLOT]: { kind: 'single', scope: 'session' } },
          },
          ChatTab,
        ),
      ),
    'side-chat: chat tab',
  )
  ctx.effect(
    () =>
      ctx.slots.inject(CONVERSATION_SLOT, () =>
        ctx.slots.register({ name: CONVERSATION_SLOT }, ConversationPanel),
      ),
    'side-chat: conversation',
  )

  const showChat = (fork: string, replaceTab?: TabId): void =>
    ctx.sidebarRight.openResource(chatAddress(fork), {
      kind: KIND,
      ...(replaceTab === undefined ? {} : { replaceTab }),
    })

  /** Fork `sessionId` into a side chat and show it, in place of `replaceTab` when given. */
  const open = async (sessionId: string, replaceTab?: TabId): Promise<void> => {
    const source = ctx.sessions.list.getSnapshot().byId[SessionId(sessionId)]
    const title = `${t('title')}: ${source?.title ?? source?.displayTitle ?? sessionId}`
    const result = await ctx.connection.rpc.call(
      RPC_CHANNEL,
      RPC_METHOD,
      { sessionId, title },
      AbortSignal.timeout(RPC_TIMEOUT_MS),
    )
    if (!result.ok) throw new RpcFailure(result.error.code, result.error.message)
    const fork = createResponseSchema.parse(result.value).sessionId
    showChat(fork, replaceTab)
  }

  // The guide card opens a start page, which forks the on-screen session and
  // turns into the side chat; a side chat needs a session to exist first.
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: START_ID,
        kind: START_KIND,
        title: () => t('title'),
        guide: [
          {
            id: 'new-side-chat',
            order: 30,
            title: () => t('title'),
            description: () => t('guide'),
          },
        ],
      }),
    'side-chat: start page type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: START_ID,
            locale: NAMESPACE,
            inject: (sessionId: string) => ({
              start: (tab: TabId) => open(sessionId, tab),
              describe: (error: unknown) => errorText(error, t),
            }),
          },
          StartPage,
        ),
      ),
    'side-chat: start page',
  )

  // Opening a side chat from the session list shows its source conversation
  // instead, with the side chat beside it.
  let reopen: { readonly parent: string; readonly chat: string } | undefined
  ctx.effect(
    () =>
      ctx.sidebarRight.mounted.subscribe(() => {
        const shown = ctx.sidebarRight.mounted.getSnapshot()
        if (shown === undefined) return
        // Act after the navigation that changed the on-screen session commits.
        if (reopen?.parent === shown) {
          const { chat } = reopen
          reopen = undefined
          setTimeout(() => showChat(chat))
          return
        }
        const row = ctx.sessions.list.getSnapshot().byId[shown]
        const parent = row?.parentId
        if (row?.projectionValues?.[PROJECTION_KEY] !== true || parent === undefined) return
        reopen = { parent, chat: shown }
        setTimeout(() => ctx.uiWorkspace.openSession(parent))
      }),
    'side-chat: open beside its conversation',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('conversation.chat.assistant-actions', () =>
        ctx.slots.register(
          {
            name: 'conversation.chat.assistant-actions',
            id: 'langify-side-chat',
            // After the feedback pair (10).
            order: 20,
            locale: NAMESPACE,
            inject: (sessionId: string) => ({ open: () => open(sessionId) }),
          },
          SideChatAction,
        ),
      ),
    'side-chat: message action',
  )
}

/** A failed call; `code` is one of the host's error codes unless DSH's transport failed first. */
class RpcFailure extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

interface SideChatActionProps {
  readonly open: () => Promise<void>
  readonly t: TranslateNS<typeof NAMESPACE>
}

function SideChatAction({ open, t }: SideChatActionProps): JSX.Element {
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string>()
  const onClick = (): void => {
    setPending(true)
    setFailure(undefined)
    open()
      .catch((error: unknown) => setFailure(errorText(error, t)))
      .finally(() => setPending(false))
  }
  return (
    <>
      <Tooltip label={t('action')} side="bottom">
        <button
          type="button"
          className={ACTION_CLASS}
          aria-label={t('action')}
          disabled={pending}
          onClick={onClick}
        >
          <IconNewChatOutlineRegular />
        </button>
      </Tooltip>
      {failure !== undefined && (
        <span role="status" style={{ fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }}>
          {failure}
        </span>
      )}
    </>
  )
}

function errorText(error: unknown, t: TranslateNS<typeof NAMESPACE>): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = error instanceof RpcFailure ? error.code : undefined
  const known = ERROR_CODES.find((value) => value === code)
  return known === undefined ? t('error.unexpected', { message }) : t(`error.${known}`, { message })
}

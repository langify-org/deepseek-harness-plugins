// Browser half: a Tasks tab in the right sidebar lists the justfile's recipes.
// Running one opens DSH's own terminal tab and types the `just` command into it,
// so output, Ctrl-C, and the shell are the terminal's.
/// <reference types="@deepseek-ai/dsh-api-terminal-controller/client" />
/// <reference types="@deepseek-ai/dsh-client-locale/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-renderer/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-sidebar-right/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-sidebar-terminal/client" />
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  ERROR_CODES,
  RPC_CHANNEL,
  RPC_METHOD,
  listResponseSchema,
  type ListResponse,
} from '../rpc.ts'
import { NAMESPACE, en, ja, zh } from './messages.ts'
import { CSS } from './styles.ts'
import { GuideIcon, TasksPage, TasksTitle } from './tasks-page.tsx'

// DSH 0.2 provides the browser connection without declaring it on Context.
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle
  }
}

export const inject: readonly string[] = [
  'connection',
  'locale',
  'slots',
  'sidebarRight',
  'sidebarRightTabs',
  'webTerminals',
]

const KIND = 'langify-tasks'
const TAB_ID = 'langify-tasks/list'
const TERMINAL_KIND = 'terminal'
const RPC_TIMEOUT_MS = 30_000
const TERMINAL_TIMEOUT_MS = 20_000
const PROMPT_WAIT_MS = 3_000

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh }), 'tasks: dictionaries')
  // Shown where a Japanese language pack is installed; DSH itself ships English and Chinese.
  ctx.effect(() => ctx.locale.register(NAMESPACE, 'ja', ja), 'tasks: Japanese dictionary')
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@langify-org/dsh-tasks'
    style.textContent = CSS
    document.head.append(style)
    return () => style.remove()
  }, 'tasks: styles')

  const list = async (sessionId: string): Promise<ListResponse> => {
    const result = await ctx.connection.rpc.call(
      RPC_CHANNEL,
      RPC_METHOD,
      { sessionId },
      AbortSignal.timeout(RPC_TIMEOUT_MS),
    )
    if (!result.ok) throw new RpcFailure(result.error.code, result.error.message)
    return listResponseSchema.parse(result.value)
  }

  /** Open a new terminal tab for `sessionId` and type `line` into it, with Enter. */
  const run = async (sessionId: string, line: string): Promise<void> => {
    const id = SessionId(sessionId)
    const isTerminal = (tab: { sessionId: string; kind: string }): boolean =>
      tab.sessionId === id && tab.kind === TERMINAL_KIND
    const before = new Set(
      ctx.sidebarRight.openTabs
        .getSnapshot()
        .filter(isTerminal)
        .map((tab) => tab.tabId),
    )
    // ponytail: the terminal tab's model is borrowed through ctx.webTerminals, which DSH
    // does not document for plugins; a DSH update may break it. Upgrade path: a public
    // "open a terminal running this command" API, if DSH adds one.
    ctx.sidebarRight.openTab(TERMINAL_KIND)
    const signal = AbortSignal.timeout(TERMINAL_TIMEOUT_MS)
    const tab = await until(
      ctx.sidebarRight.openTabs,
      (tabs) => tabs.find((open) => isTerminal(open) && !before.has(open.tabId)),
      signal,
    )
    // The same model the tab's body mounts, so the input lands in that tab.
    const view = ctx.webTerminals.view(id, tab.tabId, tab.contentId)
    await until(
      view.state,
      (state) => {
        if (state.phase === 'failed' || state.phase === 'closed') {
          throw new TerminalFailure(state.error ?? state.phase)
        }
        return state.phase === 'connected' && state.writable ? true : undefined
      },
      signal,
    )
    // Typed before the shell's first prompt, the line would be echoed twice;
    // a shell that prints nothing gets it after a short wait.
    await until(
      view.state,
      (state) => (state.render?.frame.type === 'output' ? true : undefined),
      AbortSignal.timeout(PROMPT_WAIT_MS),
    ).catch(() => undefined)
    view.write(`${line}\r`)
  }

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        title: () => t('title'),
        keepMounted: true,
        guide: [
          {
            id: 'langify-tasks',
            order: 40,
            title: () => t('title'),
            description: () => t('guide'),
            icon: GuideIcon,
          },
        ],
      }),
    'tasks: tab type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab',
            key: TAB_ID,
            locale: NAMESPACE,
            inject: (sessionId: string) => ({
              sessionId,
              list: () => list(sessionId),
              run: (line: string) => run(sessionId, line),
              describe: (error: unknown) => errorText(error, t),
            }),
          },
          TasksPage,
        ),
      ),
    'tasks: tab',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NAMESPACE },
          TasksTitle,
        ),
      ),
    'tasks: tab title',
  )
}

/** Resolve with the first defined `pick` of `source`'s snapshots; `pick` may throw to fail. */
function until<T, R>(
  source: ObservableSnapshot<T>,
  pick: (snapshot: T) => R | undefined,
  signal: AbortSignal,
): Promise<R> {
  const { promise, resolve, reject } = Promise.withResolvers<R>()
  const check = (): void => {
    try {
      const value = pick(source.getSnapshot())
      if (value !== undefined) resolve(value)
    } catch (error) {
      reject(error)
    }
  }
  const onAbort = (): void => reject(new TerminalFailure('timed out'))
  const unsubscribe = source.subscribe(check)
  signal.addEventListener('abort', onAbort)
  check()
  return promise.finally(() => {
    unsubscribe()
    signal.removeEventListener('abort', onAbort)
  })
}

/** A failed call; `code` is one of the host's error codes unless DSH's transport failed first. */
class RpcFailure extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

class TerminalFailure extends Error {}

function errorText(error: unknown, t: TranslateNS<typeof NAMESPACE>): string {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof TerminalFailure) return t('error.terminal', { message })
  const code = error instanceof RpcFailure ? error.code : undefined
  const known = ERROR_CODES.find((value) => value === code)
  return known === undefined ? t('error.unexpected', { message }) : t(`error.${known}`, { message })
}

// Browser half: the Browser tab in the right sidebar, one per Chromium window,
// any number per conversation. Each shows its window over VNC on WebSockets of
// its own while the window is on the screen.
/// <reference types="@deepseek-ai/dsh-client-locale/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-renderer/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-sidebar-right/client" />
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { CLOSE_PATH, TAB_KIND, type TabQuery } from '../protocol.ts'
import { BrowserPane, BrowserTitle, GuideIcon } from './browser-pane.tsx'
import { NAMESPACE, en, ja, zh } from './messages.ts'
import { CSS } from './styles.ts'

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
]

const TAB_ID = 'langify-browser/window'

/** The address of a route on DSH's API channel, beneath the page's mount. */
function apiUrl(path: string, query: Readonly<Record<string, string>>): string {
  return new URL(`${path.slice(1)}?${new URLSearchParams(query)}`, document.baseURI).href
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh }), 'browser: dictionaries')
  // Shown where a Japanese language pack is installed; DSH itself ships English and Chinese.
  ctx.effect(() => ctx.locale.register(NAMESPACE, 'ja', ja), 'browser: Japanese')
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@langify-org/dsh-browser'
    style.textContent = CSS
    document.head.append(style)
    return () => style.remove()
  }, 'browser: styles')

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: TAB_KIND,
        // Each open makes another tab, and with it another window.
        multiple: true,
        title: () => t('title'),
        guide: [
          {
            id: TAB_KIND,
            order: 31,
            title: () => t('title'),
            description: () => t('guide'),
            icon: GuideIcon,
          },
        ],
      }),
    'browser: tab type',
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
              open: (path: string, query: TabQuery) =>
                ctx.connection.openWebSocket(`${path}?${new URLSearchParams({ ...query })}`),
              apiUrl,
            }),
          },
          BrowserPane,
        ),
      ),
    'browser: tab',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NAMESPACE },
          BrowserTitle,
        ),
      ),
    'browser: tab title',
  )
  // Closing a tab closes its window; hiding it or switching conversations does not.
  ctx.effect(
    () =>
      ctx.sidebarRight.registerCloseHandler(TAB_KIND, (sessionId, tab) => {
        const query: TabQuery = { session: sessionId, tab: tab.contentId }
        fetch(apiUrl(CLOSE_PATH, { ...query }), { method: 'POST', keepalive: true }).catch(() => {})
      }),
    'browser: close handler',
  )
}

// Browser half: the terminal tab in the right sidebar, rendered with wterm and
// attached to the conversation's tmux session over a WebSocket of its own.
/// <reference types="@deepseek-ai/dsh-client-locale/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-renderer/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-sidebar-right/client" />
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { PATH } from '../protocol.ts'
import { NAMESPACE, en, ja, zh } from './messages.ts'
import { CSS } from './styles.ts'
import { GuideIcon, TerminalPane, TerminalTitle, type Socket } from './terminal-pane.tsx'

// DSH 0.2 provides the browser connection without declaring it on Context.
declare module '@deepseek-ai/cordis' {
  interface Context {
    connection: ConnectionHandle
  }
}

export const inject: readonly string[] = ['connection', 'locale', 'slots', 'sidebarRightTabs']

const KIND = 'langify-tmux'
const TAB_ID = 'langify-tmux/terminal'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh }), 'tmux: dictionaries')
  ctx.effect(() => ctx.locale.register(NAMESPACE, 'ja', ja), 'tmux: Japanese')
  const t = ctx.locale.bind(NAMESPACE)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = '@langify-org/dsh-tmux'
    style.textContent = CSS
    document.head.append(style)
    return () => style.remove()
  }, 'tmux: styles')

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: TAB_ID,
        kind: KIND,
        title: () => t('title'),
        guide: [
          {
            id: KIND,
            order: 30,
            title: () => t('title'),
            description: () => t('guide'),
            icon: GuideIcon,
          },
        ],
      }),
    'tmux: tab type',
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
              connect: (cols: number, rows: number): Socket => {
                const query = new URLSearchParams({
                  session: sessionId,
                  cols: String(cols),
                  rows: String(rows),
                })
                return ctx.connection.openWebSocket(`${PATH}?${query}`)
              },
            }),
          },
          TerminalPane,
        ),
      ),
    'tmux: tab',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab.title', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NAMESPACE },
          TerminalTitle,
        ),
      ),
    'tmux: tab title',
  )
}

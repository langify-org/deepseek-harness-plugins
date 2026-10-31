// Browser half of the plugin: the Code page in the right sidebar, and the
// redirect that sends text-file links to it.
// Declarations of the injected services and of file-link parameters.
/// <reference types="@deepseek-ai/dsh-client-locale/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-renderer/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client" />
/// <reference types="@deepseek-ai/dsh-client-ui-sidebar-right/client" />
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { CodePage } from './code-page.tsx'
import { CODE_KIND, createFace, type Face } from './face.ts'
import { FileRedirect } from './file-redirect.tsx'
import { NAMESPACE, en, ja, zh } from './locales.ts'
import { isTextFileAddress } from './text-files.ts'

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

const PAGE_ID = 'langify-code-server/page'
const FILE_ID = 'langify-code-server/file'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, { en, zh }), 'code-server: dictionaries')
  // Shown where a Japanese language pack is installed; DSH itself ships English and Chinese.
  ctx.effect(() => ctx.locale.register(NAMESPACE, 'ja', ja), 'code-server: Japanese dictionary')
  const t = ctx.locale.bind(NAMESPACE)

  const faces = new Map<string, Face>()
  const face = (sessionId: string): Face => {
    let existing = faces.get(sessionId)
    if (existing === undefined) {
      existing = createFace(ctx, sessionId)
      faces.set(sessionId, existing)
    }
    return existing
  }

  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: PAGE_ID,
        kind: CODE_KIND,
        title: () => t('title'),
        keepMounted: true,
        guide: [
          { id: 'open-code', order: 25, title: () => t('title'), description: () => t('guide') },
        ],
      }),
    'code-server: page type',
  )
  ctx.effect(
    () =>
      ctx.sidebarRightTabs.register({
        id: FILE_ID,
        kind: `${CODE_KIND}-file`,
        patterns: ['dsh-resource://file/**'],
        priority: 'extension',
        title: () => t('title'),
        canOpen: isTextFileAddress,
      }),
    'code-server: file-link type',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: PAGE_ID, inject: face, locale: NAMESPACE },
          CodePage,
        ),
      ),
    'code-server: page',
  )
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: FILE_ID, inject: face, locale: NAMESPACE },
          FileRedirect,
        ),
      ),
    'code-server: file-link redirect',
  )
  ctx.effect(
    () =>
      ctx.sidebarRight.registerCloseHandler(CODE_KIND, (sessionId, tab) =>
        faces.get(sessionId)?.bus.release(tab.id),
      ),
    'code-server: close handler',
  )
  ctx.effect(
    () => () => {
      for (const { bus } of faces.values()) bus.phase('closed')
      faces.clear()
    },
    'code-server: sessions',
  )
}

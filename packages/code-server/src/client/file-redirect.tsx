import { useLayoutEffect, type JSX } from 'react'
import type { UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { CODE_KIND, type Face } from './face.ts'
import type { NAMESPACE } from './locales.ts'

export interface FileRedirectProps extends Face {
  readonly t: TranslateNS<typeof NAMESPACE>
  readonly useTabInfo: UseSidebarRightTabInfo
}

/**
 * Claims text-file links and hands them to the session's Code page. DSH has no
 * hook before a file tab opens, so this short-lived tab replaces itself with the
 * Code page, or closes after revealing an open one.
 */
export function FileRedirect({
  bus,
  findCode,
  reveal,
  isCurrent,
  t,
  useTabInfo,
}: FileRedirectProps): JSX.Element {
  const { tab } = useTabInfo()
  useLayoutEffect(() => {
    if (!isCurrent() || !tab.visible) return
    const { address, params, revision } = tab.navigation
    bus.enqueue(`${tab.id}:${revision}`, { address, line: params?.line })
    const code = findCode()
    if (code === undefined) return tab.actions.openTab(CODE_KIND, { replaceTab: true })
    reveal(code.tabId)
    tab.actions.close()
    // tab.actions changes identity across renders; the navigation revision identifies the request.
  }, [bus, findCode, reveal, isCurrent, tab.id, tab.navigation.revision, tab.visible])
  return <div style={{ padding: 16 }}>{t('opening')}</div>
}

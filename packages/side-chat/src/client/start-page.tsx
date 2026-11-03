import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TabId, UseSidebarRightTabInfo } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NAMESPACE } from './messages.ts'

export interface StartPageProps {
  /** Fork the session into a side chat that takes this tab's place. */
  readonly start: (tab: TabId) => Promise<void>
  readonly describe: (error: unknown) => string
  readonly t: TranslateNS<typeof NAMESPACE>
  readonly useTabInfo: UseSidebarRightTabInfo
}

/** The guide card's page: starts a side chat at once and is replaced by it. */
export function StartPage({ start, describe, t, useTabInfo }: StartPageProps): JSX.Element {
  const { tab } = useTabInfo()
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState<string>()
  // One fork per attempt, also when React runs the effect twice.
  const started = useRef(-1)
  useEffect(() => {
    if (started.current === attempt) return
    started.current = attempt
    setError(undefined)
    start(tab.id).catch((failure: unknown) => {
      if (!tab.signal.aborted) setError(describe(failure))
    })
  }, [attempt, start, describe, tab.id, tab.signal])

  return (
    <div role={error === undefined ? 'status' : 'alert'} style={styles.page}>
      <span>{error ?? t('starting')}</span>
      {error !== undefined && (
        <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          {t('retry')}
        </Button>
      )}
    </div>
  )
}

const styles = {
  page: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 16,
    textAlign: 'center',
    overflowWrap: 'anywhere',
    color: 'var(--dsw-alias-label-secondary)',
  },
} satisfies Record<string, CSSProperties>

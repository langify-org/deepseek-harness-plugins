/**
 * The DSH client services this plugin uses, typed by hand to the members it
 * calls (DSH 0.2.0-rc.2). The real types live in DSH's client packages, which
 * this prototype does not depend on; keep these in step with them.
 */
import type { ComponentType } from 'react'

export interface UiWorkspace {
  openWorkspace(workspaceId: string, beforeOpen?: (sessionId: string) => void): Promise<void>
}

export interface SidebarRight {
  readonly mounted: { getSnapshot(): string | undefined }
  openTab(kind: string, options?: { replaceTab?: string; paneId?: string }): void
}

export interface SidebarRightTabs {
  register(definition: {
    id: string
    kind: string
    title: (address: string) => string
    multiple?: boolean
    guide?: readonly {
      id: string
      order: number
      title: () => string
      description?: () => string
      icon?: ComponentType<{ className?: string }>
    }[]
  }): () => void
}

export interface Slots {
  inject(name: string, register: () => () => void): () => void
  register(
    options: { name: string; key: string; inject: (sessionId: string) => Record<string, unknown> },
    component: ComponentType<never>,
  ): () => void
}

/** What the browser half needs from its Cordis context. */
export interface ClientContext {
  readonly uiWorkspace: UiWorkspace
  readonly sidebarRight: SidebarRight
  readonly sidebarRightTabs: SidebarRightTabs
  readonly slots: Slots
  effect(execute: () => () => unknown, label?: string): unknown
}

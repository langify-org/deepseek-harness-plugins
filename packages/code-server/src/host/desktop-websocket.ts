// A script the relay adds to code-server's page, ahead of code-server's own.
// DSH Desktop shows DSH at dsh-app://app and forwards that scheme's HTTP to its
// Host, but code-server dials its server at the page's own host, so its
// WebSockets would go to ws://app. Desktop publishes the Host's address as
// __DSH_TRANSPORT__.streamBaseUrl and adds DSH's credentials to WebSockets
// sent there, so the script points code-server's WebSockets at it. In a
// browser the global is absent and the script changes nothing.

/** The parts of the code-server page's window the script uses. */
export interface Page {
  readonly location: { readonly href: string; readonly hostname: string }
  readonly parent: { readonly __DSH_TRANSPORT__?: { readonly streamBaseUrl?: unknown } }
  WebSocket: new (url: string | URL, protocols?: string | string[]) => object
}

/** Self-contained: it is serialized into {@link DESKTOP_WEBSOCKET_SCRIPT}. */
export function retargetWebSockets(page: Page): void {
  let base: unknown
  try {
    // oxlint-disable-next-line no-underscore-dangle -- the name DSH Desktop gives it
    base = page.parent.__DSH_TRANSPORT__?.streamBaseUrl
  } catch {
    return // a parent of another origin: not DSH's page
  }
  if (typeof base !== 'string') return
  const host = new URL(base)
  const scheme = host.protocol === 'https:' ? 'wss:' : 'ws:'
  const Native = page.WebSocket
  page.WebSocket = class extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      const target = new URL(url, page.location.href)
      if (target.hostname === page.location.hostname) {
        target.protocol = scheme
        target.host = host.host
      }
      super(target, protocols)
    }
  }
}

export const DESKTOP_WEBSOCKET_SCRIPT: string = `(${retargetWebSockets.toString()})(window)\n`

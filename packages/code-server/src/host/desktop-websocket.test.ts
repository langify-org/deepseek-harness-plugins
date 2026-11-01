import { expect, it } from 'vitest'
import { retargetWebSockets, type Page } from './desktop-websocket.ts'

class Recorder {
  readonly url: string
  constructor(url: string | URL) {
    this.url = String(url)
  }
}

function page(parent: Page['parent']): Page {
  return {
    location: { href: 'dsh-app://app/code-server/?folder=/tmp', hostname: 'app' },
    parent,
    WebSocket: Recorder,
  }
}

it("sends Desktop's WebSockets for the page's own host to DSH's Host", () => {
  const desktop = page({ __DSH_TRANSPORT__: { streamBaseUrl: 'http://127.0.0.1:43080' } })
  retargetWebSockets(desktop)
  const own = new desktop.WebSocket('ws://app/code-server/stable-1?reconnectionToken=t')
  expect(own).toMatchObject({
    url: 'ws://127.0.0.1:43080/code-server/stable-1?reconnectionToken=t',
  })
  expect(new desktop.WebSocket('wss://example.com/')).toMatchObject({ url: 'wss://example.com/' })
})

it('leaves a browser page alone', () => {
  const browser = page({})
  retargetWebSockets(browser)
  expect(browser.WebSocket).toBe(Recorder)
})

// The editor at the plugin's own address on 127.0.0.1, for DSH Desktop.
//
// Desktop shows DSH at dsh-app://app, where code-server cannot run: it builds
// its server's addresses from its own page's, and that scheme allows no service
// workers. Desktop's Host cannot serve it either, as Desktop refuses WebSockets
// to its Host from any origin but its own. So the plugin serves the editor on a
// plain http origin of its own, apart from DSH's.
//
// The listener starts when Desktop first asks for an editor. The editor's
// address carries a random token in its path; code-server addresses everything
// relative to its page, so every request and WebSocket carries it, and it is
// the credential. Only pages DSH authenticated receive it, from the create RPC.
// The port stays the same across runs, since the browser keeps the editor's
// state (trusted folders, layout) per origin.
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { RunningCodeServer } from '../code-server.ts'
import { CodeServerError } from '../errors.ts'
import { relayRequests, relayUpgrades, type RelayOptions } from '../relay.ts'

const HOST = '127.0.0.1'

interface Listener {
  readonly server: Server
  readonly origin: string
}

export class DesktopIngress {
  readonly #port: number
  readonly #start: () => Promise<RunningCodeServer>
  readonly #token = randomBytes(32).toString('base64url')
  #listening: Promise<Listener> | undefined

  /** @param port - 0 picks a free port, which changes the editor's origin on every run. */
  constructor(port: number, start: () => Promise<RunningCodeServer>) {
    this.#port = port
    this.#start = start
  }

  /** The editor's address, listening from the first call on. */
  async base(): Promise<string> {
    this.#listening ??= this.#listen().catch((error: unknown) => {
      this.#listening = undefined
      throw error
    })
    return `${(await this.#listening).origin}/${this.#token}/`
  }

  async dispose(): Promise<void> {
    const listener = await this.#listening?.catch(() => undefined)
    this.#listening = undefined
    if (listener === undefined) return
    const { server } = listener
    const closed = new Promise<void>((resolve) => server.close(() => resolve()))
    server.closeAllConnections()
    await closed
  }

  async #listen(): Promise<Listener> {
    let host = ''
    const relay: RelayOptions = {
      prefix: `/${this.#token}`,
      admit: (req) => this.#admit(req, host),
      start: this.#start,
    }
    const handle = relayRequests(relay)
    const server = createServer((req, res) => void handle(req, res))
    server.on('upgrade', relayUpgrades(relay))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.#port, HOST, () => {
        server.off('error', reject)
        resolve()
      })
    }).catch((error: unknown) => {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code !== 'EADDRINUSE') throw error
      throw new CodeServerError('desktop_port_in_use', `${HOST}:${this.#port}`, { cause: error })
    })
    const address = server.address()
    host = `${HOST}:${typeof address === 'object' && address !== null ? address.port : this.#port}`
    return { server, origin: `http://${host}` }
  }

  /** @param host - the listener's own host and port. */
  #admit(req: IncomingMessage, host: string): number | undefined {
    // Another site's page reaching this port by DNS rebinding names its own host.
    if (req.headers.host !== host) return 403
    const token = Buffer.from((req.url ?? '').split('/', 2)[1] ?? '')
    const expected = Buffer.from(this.#token)
    return token.length === expected.length && timingSafeEqual(token, expected) ? undefined : 404
  }
}

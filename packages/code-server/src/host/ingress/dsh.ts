// The editor under DSH's own origin, at /code-server. DSH authenticates the
// browser before the relay forwards anything, so this serves every page DSH
// serves over http(s), on this machine or from a phone. The editor shares
// DSH's origin; see the README's security notes.
import type { Context } from '@deepseek-ai/cordis'
import type { RunningCodeServer } from '../code-server.ts'
import { relayRequests, relayUpgrades, type RelayOptions } from '../relay.ts'
import type { Services } from '../services.ts'

const PREFIX = '/code-server'

export interface DshIngress {
  /** The editor's address, relative to the DSH page. */
  readonly base: string
  /** Serve a started code-server's WebSocket, whose path names its commit, until it exits. */
  readonly serveWebSocket: (server: RunningCodeServer) => () => void
}

export function dshIngress(
  ctx: Context & Services,
  start: () => Promise<RunningCodeServer>,
): DshIngress {
  const relay: RelayOptions = {
    prefix: PREFIX,
    admit: (req) => ctx.connection.requestRejection({ headers: req.headers }),
    start,
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler: relayRequests(relay) }),
    'code-server: DSH ingress',
  )
  return {
    base: `${PREFIX.slice(1)}/`,
    // DSH routes upgrades by exact path only.
    serveWebSocket: ({ commit }) =>
      ctx.effect(
        () =>
          ctx.webServer.registerUpgrade({
            path: `${PREFIX}/stable-${commit}`,
            handler: relayUpgrades(relay),
          }),
        'code-server: DSH ingress WebSocket',
      ),
  }
}

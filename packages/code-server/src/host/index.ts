// Host half of the plugin: starts code-server, serves it under DSH's origin,
// and connects each editor window to the page that opened it.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { SOCKET_ENV } from '../bridge-protocol.ts'
import { Bridge } from './bridge.ts'
import { CodeServer } from './code-server.ts'
import { rpcRoutes } from './handlers.ts'
import { RELAY_PREFIX, relayRequests, relayUpgrades, type Admission } from './relay.ts'
import type { Services } from './services.ts'

export { inject } from './services.ts'

export const name = 'langify-code-server'

/** Empty directories mean code-server's own defaults. */
export interface Config {
  command: string
  userDataDir: string
  extensionsDir: string
}

export const Config: Schema<Config> = Schema.object({
  command: Schema.string()
    .default('code-server')
    .description('code-server executable name or path.'),
  userDataDir: Schema.string()
    .default('')
    .description("code-server's --user-data-dir. Empty uses its default."),
  extensionsDir: Schema.string()
    .default('')
    .description("code-server's --extensions-dir. Empty uses its default."),
})

export async function apply(ctx: Context & Services, config: Config): Promise<void> {
  // Sockets live in a fresh directory only this user can enter (mkdtemp creates it 0700).
  const runtimeDir = await mkdtemp(
    join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'dsh-code-server-'),
  )
  ctx.effect(
    () => () => rm(runtimeDir, { recursive: true, force: true }),
    'code-server: runtime directory',
  )

  const bridge = await Bridge.listen(join(runtimeDir, 'bridge.sock'))
  ctx.effect(() => () => bridge.dispose(), 'code-server: bridge')

  const admission: Admission = (request) => ctx.connection.requestRejection(request)
  const codeServer = new CodeServer(
    ctx.subprocess,
    {
      command: config.command,
      userDataDir: config.userDataDir || undefined,
      extensionsDir: config.extensionsDir || undefined,
      env: { [SOCKET_ENV]: bridge.socketPath },
    },
    join(runtimeDir, 'code-server.sock'),
    // Packaged beside dist/ so that tsdown's clean step leaves it alone.
    fileURLToPath(new URL('../extension/dsh-code-bridge.vsix', import.meta.url)),
    ({ socketPath, commit }) =>
      ctx.effect(
        () =>
          ctx.webServer.registerUpgrade({
            path: `${RELAY_PREFIX}/stable-${commit}`,
            handler: relayUpgrades(admission, socketPath),
          }),
        'code-server: WebSocket relay',
      ),
  )
  ctx.effect(() => () => codeServer.dispose(), 'code-server: process')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: RELAY_PREFIX,
        handler: relayRequests(admission, () => codeServer.ensure()),
      }),
    'code-server: HTTP relay',
  )
  for (const route of rpcRoutes(ctx, bridge, codeServer)) {
    ctx.effect(() => ctx.connection.fetch.register(route), `code-server: ${route.path}`)
  }
}

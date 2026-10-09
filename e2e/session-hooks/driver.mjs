/**
 * E2E-only DSH plugin: once the app is ready, create a session through the real
 * agent registry, archive it, restore it, and report to `config.doneFile`.
 * Loaded with --patch by ./run.mjs into an isolated DSH home; never shipped.
 */
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'

export const name = 'langify-e2e-driver'
export const inject = ['agents', 'workspaceRegistry']

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function apply(ctx, config) {
  const report = (value) => writeFileSync(config.doneFile, `${JSON.stringify(value)}\n`)
  const run = async () => {
    const sessionId = `session-${randomUUID()}`
    await ctx.agents.create({ sessionId, meta: { cwd: config.cwd } })
    await sleep(config.settleMs ?? 1000)
    await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })
    await sleep(config.settleMs ?? 1000)
    await ctx.workspaceRegistry.unarchiveSession(sessionId)
    await sleep(config.settleMs ?? 1000)
    report({ ok: true, sessionId })
  }
  const start = () => {
    run().catch((error) => report({ ok: false, error: String(error?.stack ?? error) }))
  }
  const appReady = ctx.get('appReady')
  if (appReady) ctx.effect(() => appReady.onReady(start), 'e2e driver')
  else start()
}

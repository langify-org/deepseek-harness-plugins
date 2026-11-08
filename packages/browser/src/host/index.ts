// Host half: one Chromium on a virtual X display, shared by every conversation.
// Browser tabs show its windows over VNC (./routes.ts, the tab in src/client),
// the model drives them with the browser_* tools (./tools.ts), and a
// conversation's windows close when it is archived.
/// <reference types="@deepseek-ai/dsh-attachment" />
/// <reference types="@deepseek-ai/dsh-sandbox-policy" />
/// <reference types="@deepseek-ai/dsh-user-approval" />
/// <reference types="@deepseek-ai/dsh-workspace" />
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { approveEscalation } from '@deepseek-ai/dsh-sandbox'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { SharedBrowser } from './browser.ts'
import { messageOf } from './errors.ts'
import { guide } from './guide.ts'
import { serveTabs, type RouteServices } from './routes.ts'
import { browserTools, type ImageValue } from './tools.ts'

export const name = 'langify-browser'

/** The DSH host services this plugin injects. */
export interface Services extends RouteServices {
  readonly subprocess: SubprocessRuntime
  readonly systemPrompt: SystemPrompt
  readonly tools: { register(tool: ToolDefinition): () => void }
  readonly agents: { get(id: string): Agent | undefined }
}

export const inject: readonly (keyof Services)[] = [
  'webServer',
  'connection',
  'subprocess',
  'systemPrompt',
  'tools',
  'agents',
]

export interface Config {
  xvnc: string
  chromium: string
  flags: string[]
  language: string
  stateDir: string
  idleMinutes: number
}

export const Config: Schema<Config> = Schema.object({
  xvnc: Schema.string()
    .default('Xvnc')
    .description('The Xvnc executable (TigerVNC): a name looked up on PATH, or a path.'),
  chromium: Schema.string()
    .default('chromium')
    .description('The Chromium executable: a name looked up on PATH, or a path.'),
  flags: Schema.array(Schema.string())
    .default(['--disable-gpu'])
    .description('Command-line flags added after the plugin’s own.'),
  language: Schema.string()
    .default('')
    .description(
      'The language of Chromium’s own interface (LANGUAGE), such as ja. Empty keeps the host’s.',
    ),
  stateDir: Schema.string()
    .required()
    .description('Where the browser keeps its profile, downloads and uploads.'),
  idleMinutes: Schema.natural()
    .default(30)
    .description(
      'Stop the browser after this many minutes with no Browser tab on view and no use. 0 keeps it running.',
    ),
})

const archivedIds = z.object({ archivedSessionIds: z.array(z.string()) })

export async function apply(ctx: Context & Services, config: Config): Promise<void> {
  // The VNC socket lives in a fresh directory only this user can enter (mkdtemp creates it 0700).
  const runtimeDir = await mkdtemp(join(process.env.XDG_RUNTIME_DIR ?? tmpdir(), 'dsh-browser-'))
  ctx.effect(
    () => () => rm(runtimeDir, { recursive: true, force: true }),
    'browser: runtime directory',
  )
  const warn = (message: string): void => ctx.logger.warn(`browser: ${message}`)

  const browser = new SharedBrowser({
    subprocess: ctx.subprocess,
    xvnc: config.xvnc,
    chromium: config.chromium,
    flags: config.flags,
    language: config.language,
    stateDir: config.stateDir,
    runtimeDir,
    warn,
  })
  ctx.effect(() => () => browser.dispose(), 'browser: processes')
  serveTabs(ctx, browser)

  /** The conversation a subagent works for: subagents share their conversation's windows. */
  const owner = (agent: Agent): string => {
    let current = agent
    for (const seen = new Set<string>(); ; seen.add(current.id)) {
      const { origin, parentSession } = current.session.header
      if (origin !== 'subagent' || parentSession === undefined || seen.has(current.id)) {
        return current.id
      }
      const parent = ctx.agents.get(parentSession)
      if (parent === undefined) return parentSession
      current = parent
    }
  }

  const tools = browserTools({
    browser,
    owner,
    async allow(agent, exec, what) {
      // The browser runs outside the sandbox: the same one-shot escalation bash asks for.
      const effectiveMode =
        ctx.get('sandboxPolicy')?.resolve({ session: agent.session }).mode ?? 'read-only'
      await approveEscalation(
        {
          requestedMode: 'danger-full-access',
          effectiveMode,
          subject: 'command',
          justification: what,
        },
        {
          approver: ctx.get('approval'),
          agent,
          callId: exec.callId,
          toolName: exec.name,
          signal: exec.signal,
        },
      )
    },
    async saveImage(exec: ToolRunContext, data: Uint8Array): Promise<ImageValue> {
      const attachments = ctx.get('attachments')
      if (attachments === undefined) {
        throw new Error('Screenshots need DSH’s attachment store, which is not running.')
      }
      // As read_image: a route whose model takes no images gets no image in its history.
      const routed = exec.agent?.session.requestHeader()?.config
      const provider = routed?.provider ?? exec.agent?.options.provider
      const model = routed?.model ?? exec.agent?.options.model
      const llm = ctx.get('llm')
      if (provider === undefined || model === undefined || llm === undefined) {
        throw new Error('The current model could not be resolved, so a screenshot cannot be sent.')
      }
      const info = await llm.resolveModelInfo(provider, model, exec.signal)
      if (info.inputModalities?.includes('image') !== true) {
        throw new Error(`Model "${model}" does not take images; read the page with browser_eval.`)
      }
      const ref = await attachments.saveImage({ data, mediaType: 'image/png', name: 'browser.png' })
      return {
        attachmentId: ref.attachmentId,
        mediaType: ref.mediaType,
        bytes: ref.bytes,
        width: ref.width,
        height: ref.height,
        ...(ref.originalDimensions === undefined
          ? {}
          : { originalDimensions: { ...ref.originalDimensions } }),
      }
    },
  })
  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register(tool), `browser: ${tool.name}`)
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'langify-browser',
        order: ctx.systemPrompt.getSectionOrder('TOOL_PTY') + 2,
        text: guide(browser.downloadsDir),
        interpolate: false,
      }),
    'browser: system prompt',
  )

  if (config.idleMinutes > 0) {
    const idleMs = config.idleMinutes * 60_000
    ctx.effect(() => {
      const timer = setInterval(() => browser.stopIfIdle(idleMs), 60_000)
      timer.unref()
      return () => clearInterval(timer)
    }, 'browser: idle stop')
  }

  // A conversation's windows go when it is archived: every archive writes the workspace state.
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return
    const state = archivedIds.safeParse(change.value)
    if (!state.success) return
    for (const sessionId of state.data.archivedSessionIds) {
      browser
        .closeSession(sessionId)
        .catch((error: unknown) => warn(`closing windows: ${messageOf(error)}`))
    }
  })
}

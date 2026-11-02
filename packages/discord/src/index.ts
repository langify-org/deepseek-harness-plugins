// Bridges Discord threads to DSH Sessions. A message in a configured channel
// opens a thread and a Session for it (`discord-<thread id>`); messages in that
// thread are the Session's prompts, and its replies, tool approvals and
// questions come back to the thread.
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {
  SessionPromptRequest,
  SessionRequestId,
} from '@deepseek-ai/dsh-api-session-controller'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import Schema from '@deepseek-ai/schemastery'
import {
  ApplicationCommandType,
  Client,
  GatewayDispatchEvents,
  GatewayIntentBits,
  type GatewayMessageCreateDispatchData,
  type APIInteraction,
  InteractionContextType,
  InteractionType,
  MessageFlags,
  MessageType,
  ThreadAutoArchiveDuration,
} from '@discordjs/core'
import { REST } from '@discordjs/rest'
import { WebSocketManager } from '@discordjs/ws'
import { Outbox, parseCustomId, sessionIdOf, threadOf, truncate } from './discord.ts'
import { askApproval, askQuestions, PendingRequests } from './interactive.ts'
import type { Services } from './services.ts'

export const name = 'langify-discord'

export { inject } from './services.ts'

export interface Channel {
  channelId: string
  cwd: string
}

export interface Config {
  tokenEnv: string
  userId: string
  channels: Channel[]
}

export const Config: Schema<Config> = Schema.object({
  tokenEnv: Schema.string()
    .default('DISCORD_BOT_TOKEN')
    .description('Credential name holding the bot token: saved credentials, then the environment.'),
  userId: Schema.string()
    .default('')
    .description('Your Discord user ID. Only this user is listened to.'),
  channels: Schema.array(
    Schema.object({
      channelId: Schema.string().required().description('Text channel ID.'),
      cwd: Schema.string().required().description('Working folder of Sessions started there.'),
    }),
  )
    .default([])
    .description('Channels where a new message starts a thread and a Session.'),
})

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
type PromptPart = SessionPromptRequest['content'][number]

export async function apply(ctx: Context & Services, config: Config): Promise<void> {
  if (!/^\d+$/.test(config.userId)) throw new Error('discord: set userId to your Discord user ID')
  const token = (await ctx.credentials.resolve(credentialRef(config.tokenEnv)))?.value
  if (token === undefined) throw new Error(`discord: no bot token in ${config.tokenEnv}`)

  const rest = new REST({ version: '10' }).setToken(token)
  const gateway = new WebSocketManager({
    token,
    rest,
    intents:
      GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages | GatewayIntentBits.MessageContent,
  })
  const client = new Client({ rest, gateway })
  const api = client.api
  const outbox = new Outbox(api)
  const pending = new PendingRequests()
  /** The Discord message behind each prompt still in flight, by its id. */
  const prompts = new Map<string, { channelId: string; messageId: string }>()
  /** The message whose turn is running, by thread. */
  const running = new Map<string, { channelId: string; messageId: string }>()
  const typing = new Map<string, NodeJS.Timeout>()

  const report = (threadId: string, error: unknown): void => {
    const text = error instanceof Error ? error.message : String(error)
    void outbox.text(threadId, `⚠️ ${truncate(text, 1900)}`).catch(() => undefined)
  }

  // Inbound: the owner's messages become prompts.
  const onMessage = async (message: GatewayMessageCreateDispatchData): Promise<void> => {
    if (message.author.id !== config.userId) return
    if (message.type !== MessageType.Default && message.type !== MessageType.Reply) return
    const home = config.channels.find((channel) => channel.channelId === message.channel_id)
    let threadId = message.channel_id
    if (home !== undefined) {
      try {
        const thread = await api.channels.createThread(
          message.channel_id,
          {
            name: threadName(message.content),
            auto_archive_duration: ThreadAutoArchiveDuration.OneWeek,
          },
          message.id,
        )
        threadId = thread.id
        const workspace = ctx.workspaceRegistry.list().find((entry) => entry.path === home.cwd)
        await ctx.sessionController.create({
          sessionId: SessionId(sessionIdOf(threadId)),
          ...(workspace === undefined ? { cwd: home.cwd } : { workspaceId: workspace.id }),
        })
      } catch (error) {
        report(threadId, error)
        return
      }
    } else {
      // Elsewhere, only threads with a bridged Session are ours.
      const found = await ctx.sessionController.resolveAgent(SessionId(sessionIdOf(threadId)))
      if ('error' in found) return
    }
    try {
      const content = await promptContent(message)
      if (content.length === 0) return
      prompts.set(message.id, { channelId: message.channel_id, messageId: message.id })
      // Before the prompt, so that the turn's outcome mark always comes after it.
      await api.channels.addMessageReaction(message.channel_id, message.id, '👀')
      await ctx.sessionController.prompt(
        {
          requestId: brandString<SessionRequestId>(`discord-${message.id}`),
          sessionId: SessionId(sessionIdOf(threadId)),
          mode: 'queue',
          content,
        },
        AbortSignal.timeout(60_000),
      )
    } catch (error) {
      prompts.delete(message.id)
      report(threadId, error)
    }
  }

  // Outbound: replies, turn outcomes and typing.
  ctx.on('session/event', (session, event) => {
    const threadId = threadOf(session.id)
    if (threadId === undefined) return
    if (event.type === 'user/message') {
      const rpcId = 'rpcId' in event.data.source ? String(event.data.source.rpcId) : ''
      const origin = prompts.get(rpcId.replace(/^discord-/, ''))
      if (origin !== undefined) {
        prompts.delete(origin.messageId)
        running.set(threadId, origin)
      }
    } else if (event.type === 'assistant/message') {
      const text = event.data.message.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('')
      if (text.trim() !== '')
        void outbox.text(threadId, text).catch((error: unknown) => {
          ctx.logger.warn(`discord: could not post to ${threadId}: ${String(error)}`)
        })
    } else if (event.type === 'turn/end') {
      const reason = event.data.reason
      if (reason.kind === 'error') report(threadId, reason.error.message)
      const origin = running.get(threadId)
      running.delete(threadId)
      const mark = OUTCOME_MARKS[reason.kind]
      if (origin === undefined || mark === undefined) return
      void api.channels
        .deleteOwnMessageReaction(origin.channelId, origin.messageId, '👀')
        .catch(() => undefined)
        .then(() => api.channels.addMessageReaction(origin.channelId, origin.messageId, mark))
        .catch(() => undefined)
    }
  })

  ctx.on('agent/status', ({ agent, status }) => {
    const threadId = threadOf(agent.id)
    if (threadId === undefined) return
    clearInterval(typing.get(threadId))
    typing.delete(threadId)
    if (status !== 'running') return
    // The indicator lasts 10 seconds.
    const show = (): void => void api.channels.showTyping(threadId).catch(() => undefined)
    show()
    typing.set(threadId, setInterval(show, 8_000))
  })

  // Approvals and questions for bridged Sessions are answered in the thread,
  // ahead of DSH's own dialogs; every other Session passes through.
  ctx.on(
    'approval/request',
    (request, next) => {
      const threadId = threadOf(request.agent.id)
      if (threadId === undefined) return next()
      return askApproval(api, outbox, pending, threadId, request, next)
    },
    true,
  )
  ctx.on(
    'user-questions/request',
    (request, next) => {
      const agent = request.agent
      const threadId = agent === undefined ? undefined : threadOf(agent.id)
      if (agent === undefined || threadId === undefined) return next()
      return askQuestions(
        api,
        outbox,
        pending,
        threadId,
        { ctx, sessionId: agent.id },
        request,
        next,
      )
    },
    true,
  )

  const onInteraction = async (interaction: APIInteraction): Promise<void> => {
    const user = interaction.member?.user ?? interaction.user
    if (user?.id !== config.userId) {
      await api.interactions.reply(interaction.id, interaction.token, {
        content: 'Only the owner of this bot can use it.',
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (interaction.type === InteractionType.ApplicationCommand) {
      const channelId = interaction.channel?.id ?? ''
      let content = 'Stopped.'
      try {
        ctx.sessionController.cancel({ sessionId: SessionId(sessionIdOf(channelId)) })
      } catch {
        content = 'Nothing is running in this thread.'
      }
      await api.interactions.reply(interaction.id, interaction.token, {
        content,
        flags: MessageFlags.Ephemeral,
      })
      return
    }
    if (
      interaction.type !== InteractionType.MessageComponent &&
      interaction.type !== InteractionType.ModalSubmit
    ) {
      return
    }
    const parsed = parseCustomId(interaction.data.custom_id)
    const entry = parsed === undefined ? undefined : pending.get(parsed.nonce)
    if (parsed === undefined || entry === undefined) {
      await api.interactions.updateMessage(interaction.id, interaction.token, { components: [] })
      return
    }
    await entry.handle(interaction, parsed.action)
  }

  client.on(GatewayDispatchEvents.Ready, ({ data }) => {
    ctx.logger.info(`discord: connected as ${data.user.username}`)
    void api.applicationCommands
      .bulkOverwriteGlobalCommands(data.application.id, [
        {
          name: 'stop',
          description: 'Stop the running turn in this thread',
          type: ApplicationCommandType.ChatInput,
          contexts: [InteractionContextType.Guild],
        },
      ])
      .catch((error: unknown) => {
        ctx.logger.warn(`discord: could not register /stop: ${String(error)}`)
      })
  })
  client.on(GatewayDispatchEvents.MessageCreate, ({ data }) => {
    onMessage(data).catch((error: unknown) => {
      ctx.logger.warn(`discord: message ${data.id} failed: ${String(error)}`)
    })
  })
  client.on(GatewayDispatchEvents.InteractionCreate, ({ data }) => {
    onInteraction(data).catch((error: unknown) => {
      ctx.logger.warn(`discord: interaction failed: ${String(error)}`)
    })
  })

  ctx.effect(
    () => () => {
      for (const timer of typing.values()) clearInterval(timer)
      pending.releaseAll()
      return gateway.destroy()
    },
    'discord: gateway',
  )
  await gateway.connect()
}

/** Reaction for how a turn ended; other endings get none. */
const OUTCOME_MARKS: Partial<Record<string, string>> = {
  completed: '✅',
  aborted: '⏹️',
  error: '❌',
  'max-tokens': '⚠️',
  blocked: '⛔',
}

function threadName(content: string): string {
  const line = content.trim().split('\n')[0]?.trim() ?? ''
  return truncate(line === '' ? 'DSH' : line, 100)
}

/** Message text, images inline, and other attachments as links. */
async function promptContent(message: GatewayMessageCreateDispatchData): Promise<PromptPart[]> {
  const lines = message.content.trim() === '' ? [] : [message.content]
  const images: PromptPart[] = []
  for (const attachment of message.attachments) {
    const type = attachment.content_type?.split(';')[0] ?? ''
    if (isImageType(type)) {
      const response = await fetch(attachment.url)
      if (!response.ok) throw new Error(`could not download ${attachment.filename}`)
      const data = Buffer.from(await response.arrayBuffer()).toString('base64')
      images.push({ type: 'image', mediaType: type, data, name: attachment.filename })
    } else {
      lines.push(`Attachment ${attachment.filename} (${attachment.size} bytes): ${attachment.url}`)
    }
  }
  return lines.length === 0 ? images : [{ type: 'text', text: lines.join('\n') }, ...images]
}

function isImageType(
  type: string,
): type is 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  return IMAGE_TYPES.has(type)
}

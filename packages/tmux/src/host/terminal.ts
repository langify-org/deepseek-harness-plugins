// The terminal tabs' host half: one tmux client per WebSocket from a tab, a
// view of the conversation's tmux session, run by DSH's terminal subprocess
// provider as DSH's own terminal is. Closing the socket ends the view; the
// session and its programs keep running, and the tab reconnects by attaching again.
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { homedir } from 'node:os'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { clientMessage, EXITED, NO_TMUX, openQuery, PATH, type OpenQuery } from '../protocol.ts'
import { sessionName, type Tmux } from './tmux.ts'

/** Output chunks sent and not yet written to the socket before the terminal's output pauses. */
const HIGH_WATER = 64
const LOW_WATER = 16
const GRACE_MS = 2_000

interface Spawner {
  spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle>
}

/** The DSH host services the terminal tabs use. */
export interface TerminalServices {
  readonly webServer: {
    registerUpgrade(route: {
      path: string
      handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void
    }): () => void
  }
  readonly connection: {
    requestRejection(request: { headers: IncomingHttpHeaders }): 401 | 403 | undefined
  }
  readonly agents: { get(id: string): Agent | undefined }
  readonly workingDirectory: WorkingDirectoryService
}

/** Serve the terminal tabs' WebSockets until `ctx` is disposed. */
export function serveTerminals(ctx: Context & TerminalServices, tmux: Tmux): void {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 })
  ctx.effect(
    () => () => {
      for (const socket of sockets.clients) socket.terminate()
      sockets.close()
    },
    'tmux: terminal sockets',
  )

  const serve = async (
    socket: WebSocket,
    { session: id, cols, rows }: OpenQuery,
  ): Promise<void> => {
    const closed = new AbortController()
    socket.once('close', () => closed.abort())
    const agent = ctx.agents.get(id)
    const session = sessionName(id)
    try {
      await tmux.ensureSession(
        session,
        id,
        agent === undefined ? homedir() : ctx.workingDirectory.get(agent.session),
      )
    } catch (error) {
      if (!/ENOENT/.test(messageOf(error))) throw error
      socket.close(NO_TMUX, 'tmux is not installed')
      return
    }
    // As DSH's own terminal: the session's subprocess provider, else the host's.
    const spawner = (agent?.ctx.get('subprocess') ?? ctx.get('subprocess')) as Spawner | undefined
    if (spawner === undefined) throw new Error('no subprocess provider')
    const terminal = await spawner.spawnTerminal({
      argv: tmux.attachCommand(session),
      cwd: homedir(),
      cols,
      rows,
      terminalType: 'xterm-256color',
      env: { DSH_SESSION_ID: id },
      graceMs: GRACE_MS,
      signal: closed.signal,
    })
    const end = (): void => void terminal.terminate().catch(() => {})
    if (closed.signal.aborted) return end()
    closed.signal.addEventListener('abort', end)

    let pending = 0
    terminal.output.setEncoding('utf8')
    terminal.output.on('data', (text: string) => {
      pending += 1
      if (pending > HIGH_WATER) terminal.output.pause()
      socket.send(text, () => {
        pending -= 1
        if (pending <= LOW_WATER) terminal.output.resume()
      })
    })
    void terminal.done.catch(() => {}).finally(() => socket.close(EXITED, 'exited'))

    socket.on('message', (raw: RawData) => {
      const message = clientMessage.safeParse(parseJson(textOf(raw)))
      if (!message.success) return
      const sent =
        message.data.type === 'input'
          ? terminal.write(message.data.data)
          : terminal.resize(message.data.cols, message.data.rows)
      sent.catch((error: unknown) => ctx.logger.warn(`tmux: terminal: ${messageOf(error)}`))
    })
  }

  ctx.effect(
    () =>
      ctx.webServer.registerUpgrade({
        path: PATH,
        handler(req, socket, head) {
          // DSH's upgrade routes do not authenticate: the same check as its API.
          const rejection = ctx.connection.requestRejection({ headers: req.headers })
          if (rejection !== undefined) return refuse(socket, rejection)
          const url = new URL(req.url ?? '/', 'http://localhost')
          const query = openQuery.safeParse(Object.fromEntries(url.searchParams))
          if (!query.success) return refuse(socket, 400)
          sockets.handleUpgrade(req, socket, head, (ws) => {
            serve(ws, query.data).catch((error: unknown) => {
              ctx.logger.warn(`tmux: terminal: ${messageOf(error)}`)
              ws.close(1011, 'the terminal could not start')
            })
          })
        },
      }),
    'tmux: terminal route',
  )
}

function refuse(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} ${status === 400 ? 'Bad Request' : 'Unauthorized'}\r\n\r\n`)
}

function textOf(raw: RawData): string {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return (raw instanceof ArrayBuffer ? Buffer.from(raw) : raw).toString('utf8')
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

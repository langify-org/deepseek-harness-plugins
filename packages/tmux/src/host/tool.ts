// The model's tools for the conversation's tmux session: any tmux command, aimed
// at a window of the session by its id, or at the session itself. The socket,
// the session and the target are filled in and checked by the plugin.
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { readsOnly, tmuxCommand } from '../windows.ts'
import { sessionName, type Tmux } from './tmux.ts'

/** What the tools need from the host plugin. */
export interface ToolHost {
  readonly tmux: Tmux
  /** The DSH session whose tmux session `agent` works in: its own, or its conversation's for a subagent. */
  owner(agent: Agent): string
  /** The folder new windows and panes start in. */
  cwd(agent: Agent): string
  /** Throw unless `agent` may run `what` outside the sandbox, asking the user if the session's permissions say so. */
  allow(agent: Agent, exec: ToolRunContext, what: string): Promise<void>
}

const output = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string): ContentBlock[] => [{ type: 'text', text: value }],
} as const

const command = {
  type: 'string',
  required: true,
  description: 'The tmux command name, such as capture-pane or send-keys.',
} as const

const args = {
  type: 'array',
  items: { type: 'string' },
  description: 'Arguments after the command name, one per item. -t is filled in; do not pass it.',
} as const

const PERMISSION =
  'tmux runs outside your sandbox: a command that changes anything needs the same permission as a command outside it; reading (capture-pane -p, list-windows, list-panes, show-options) does not.'

function agentOf(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error('the tmux tools need a conversation')
  return exec.agent
}

/** Run one checked command for `agent`, asking for permission unless it only reads; `prepare` runs once allowed. */
async function run(
  host: ToolHost,
  agent: Agent,
  exec: ToolRunContext,
  target: string,
  name: string,
  rest: readonly string[],
  prepare?: () => Promise<void>,
): Promise<string> {
  const line = tmuxCommand(target, name, rest, host.cwd(agent))
  if (!readsOnly(name, rest)) await host.allow(agent, exec, `tmux ${line.join(' ')}`)
  await prepare?.()
  return (await host.tmux.run(line)).trimEnd() || '(no output)'
}

/** `tmux_window` and `tmux_session`, bound to the host's tmux server. */
export function tmuxTools(host: ToolHost): ToolDefinition[] {
  return [
    defineTool({
      name: 'tmux_window',
      description: `Run a tmux command on one window, or one pane of it, of this conversation's tmux session (see Shared terminal). Aim at the window by its id, such as @3. Examples: capture-pane [-p] reads it; send-keys [-l, ls] then send-keys [Enter] runs ls; split-window [-d] splits it. ${PERMISSION}`,
      parameters: {
        window: { type: 'string', required: true, description: 'The window id, such as @3.' },
        pane: {
          type: 'integer',
          description: 'The pane index within the window. Without it, the active pane.',
        },
        command,
        args,
      },
      output,
      async execute(input, exec) {
        const agent = agentOf(exec)
        const session = sessionName(host.owner(agent))
        if (!/^@\d+$/.test(input.window))
          throw new Error(`"${input.window}" is not a window id such as @3.`)
        const windows = await host.tmux.windows(session)
        if (!windows.some((w) => w.id === input.window)) {
          const ids = windows.map((w) => `${w.id} "${w.name}"`).join(', ') || 'none'
          throw new Error(
            `This conversation's tmux session has no window ${input.window}. Its windows: ${ids}.`,
          )
        }
        let target = input.window
        if (input.pane !== undefined) {
          const panes = await host.tmux.panes(input.window)
          if (!panes.includes(input.pane)) {
            throw new Error(
              `Window ${input.window} has no pane ${input.pane}. Its panes: ${panes.join(', ')}.`,
            )
          }
          target = `${input.window}.${input.pane}`
        }
        return run(host, agent, exec, target, input.command, input.args ?? [])
      },
    }),
    defineTool({
      name: 'tmux_session',
      description: `Run a tmux command on this conversation's tmux session as a whole (see Shared terminal). Examples: new-window [-d] opens a window in the conversation's folder without switching the user's view, and prints its id, creating the session if there is none; list-windows lists the windows. ${PERMISSION}`,
      parameters: { command, args },
      output,
      async execute(input, exec) {
        const agent = agentOf(exec)
        const owner = host.owner(agent)
        const session = sessionName(owner)
        // A new window without a session: create the session as the terminal tab would.
        const opens = input.command === 'new-window' || input.command === 'neww'
        return run(
          host,
          agent,
          exec,
          `=${session}:`,
          input.command,
          input.args ?? [],
          opens ? () => host.tmux.ensureSession(session, owner, host.cwd(agent)) : undefined,
        )
      },
    }),
  ]
}

// VS Code extension, active in code-server windows the DSH page opened: it
// claims the window's binding over the host plugin's private socket, shows the
// files the page asks for in this window only, and is where the user hears
// about this connection while the window is connected.
import { lstatSync, realpathSync } from 'node:fs'
import { createConnection } from 'node:net'
import * as vscode from 'vscode'
import { z } from 'zod'
import { format, messagesFor, type Messages } from '../messages.ts'
import {
  BINDING_FRAGMENT,
  SOCKET_ENV,
  frame,
  handshakeReplySchema,
  hostFrameSchema,
  readFrames,
  type OpenRequest,
  type OpenResult,
} from '../bridge-protocol.ts'
import type { ErrorCode, OpenErrorCode } from '../rpc.ts'
import { checkSocket } from './socket-check.ts'

const HANDSHAKE_TIMEOUT_MS = 10_000
const MENU = 'langify-org.dsh-code-bridge.menu'

type ConnectionState = 'connecting' | 'connected' | 'disconnected'

interface Connection {
  readonly connected: () => boolean
  /** Ask the page for a new window, after the user dealt with unsaved changes. */
  readonly reconnect: () => Promise<void>
  readonly dispose: () => void
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Stay silent in code-server instances DSH did not start and in windows its page did not open.
  const socketPath = process.env[SOCKET_ENV]
  if (socketPath === undefined) return
  const bindingId = await windowBinding()
  if (bindingId === undefined) return
  const text = messagesFor(vscode.env.language)
  const output = vscode.window.createOutputChannel('DSH Code Bridge')
  const log = (message: string): void => output.appendLine(message)
  const status = statusItem(text)
  let connection: Connection | undefined
  const menu = async (): Promise<void> => {
    const reconnect = { label: text.reconnect }
    const showLog = { label: text['status.showLog'] }
    const items = connection?.connected() === true ? [reconnect, showLog] : [showLog]
    const choice = await vscode.window.showQuickPick(items, { title: text['status.name'] })
    if (choice === reconnect) await connection?.reconnect()
    if (choice === showLog) output.show()
  }
  context.subscriptions.push(output, status.item, vscode.commands.registerCommand(MENU, menu))
  try {
    checkSocket(socketPath)
    const cwd = workspaceFolder()
    connection = connect(bindingId, socketPath, cwd, text, log, (state) => status.show(state, cwd))
    context.subscriptions.push(connection)
  } catch (error) {
    log(`Not connected: ${messageOf(error)}`)
    status.show('disconnected')
  }
}

/** The connection's state in the status bar; clicking it opens the connection menu. */
function statusItem(text: Messages): {
  readonly item: vscode.StatusBarItem
  readonly show: (state: ConnectionState, cwd?: string) => void
} {
  const item = vscode.window.createStatusBarItem(
    'langify-org.dsh-code-bridge.status',
    vscode.StatusBarAlignment.Left,
  )
  item.name = text['status.name']
  item.command = { command: MENU, title: text['status.name'] }
  const icons: Record<ConnectionState, string> = {
    connecting: '$(sync~spin)',
    connected: '$(plug)',
    disconnected: '$(debug-disconnect)',
  }
  const show = (state: ConnectionState, cwd?: string): void => {
    item.text = `${icons[state]} DSH`
    const lines = [
      text[`status.${state}`],
      ...(state === 'connected' && cwd !== undefined ? [cwd] : []),
    ]
    item.tooltip = lines.join('\n')
    item.backgroundColor =
      state === 'disconnected'
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined
    item.show()
  }
  return { item, show }
}

/**
 * The binding in this window's URL fragment. `asExternalUri` builds its answer
 * from the window's own address, and keeps that address's fragment.
 */
async function windowBinding(): Promise<string | undefined> {
  const probe = vscode.Uri.parse(`${vscode.env.uriScheme}://langify-org.dsh-code-bridge/binding`)
  const external = await vscode.env.asExternalUri(probe)
  const bindingId = z.uuid().safeParse(new URLSearchParams(external.fragment).get(BINDING_FRAGMENT))
  return bindingId.success ? bindingId.data : undefined
}

/** The window's only folder, canonicalized as the host canonicalized it. */
function workspaceFolder(): string {
  const folders = vscode.workspace.workspaceFolders ?? []
  const [folder] = folders
  if (
    folders.length !== 1 ||
    folder === undefined ||
    !['file', 'vscode-remote'].includes(folder.uri.scheme)
  ) {
    throw new Error('The window must have exactly one local folder')
  }
  return realpathSync(folder.uri.fsPath)
}

function connect(
  bindingId: string,
  socketPath: string,
  cwd: string,
  text: Messages,
  log: (message: string) => void,
  report: (state: ConnectionState) => void,
): Connection {
  const socket = createConnection({ path: socketPath })
  const queue: OpenRequest[] = []
  let accepted = false
  let closed = false
  let draining = false
  /** `quietly` when the extension stops: its status bar item is going away too. */
  const close = (reason: string, quietly = false): void => {
    if (closed) return
    closed = true
    queue.length = 0
    clearTimeout(handshake)
    log(reason)
    if (!quietly) report('disconnected')
    socket.destroy()
  }
  report('connecting')
  const handshake = setTimeout(() => close('No answer from DSH'), HANDSHAKE_TIMEOUT_MS)

  const showError = (code: ErrorCode, message: string): void => {
    void vscode.window.showWarningMessage(format(text[`error.${code}`], { message }))
  }

  const reconnect = async (): Promise<void> => {
    if (!accepted || closed) return
    if (vscode.workspace.textDocuments.some((document) => document.isDirty)) {
      const saveAll = text['reconnect.saveAll']
      const choice = await vscode.window.showWarningMessage(
        text['reconnect.unsaved'],
        { modal: true },
        saveAll,
      )
      if (choice !== saveAll || !(await vscode.workspace.saveAll(true))) return
    }
    if (!closed) socket.write(frame({ type: 'reconnect' }))
  }

  const offerReopen = async (folder: string): Promise<void> => {
    const reopen = text['cwd.reopen']
    const choice = await vscode.window.showInformationMessage(
      format(text['cwd.changed'], { cwd: folder }),
      reopen,
    )
    if (choice === reopen) await reconnect()
  }

  // Requests run one at a time; a request the editor never answers holds the rest.
  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    for (let request = queue.shift(); request !== undefined; request = queue.shift()) {
      const result = await openFile(request)
      if (closed) break
      // This window found the failure, so it shows it; the host only passes it on.
      if (!result.ok) showError(result.error.code, result.error.message)
      socket.write(frame(result))
    }
    draining = false
  }

  socket.once('connect', () => socket.write(frame({ type: 'hello', bindingId, cwd })))
  socket.on('error', (error) => close(`Connection failed: ${error.message}`))
  // No retry from here: a reloaded window attaches again by itself, and Reconnect
  // in DSH's Code tab opens a new window.
  socket.on('close', () =>
    close(
      'Disconnected from DSH. If files from DSH stop opening here, use Reconnect in its Code tab.',
    ),
  )
  readFrames(
    socket,
    (value) => {
      if (!accepted) {
        const reply = handshakeReplySchema.safeParse(value)
        if (!reply.success) return close('Invalid answer from DSH')
        if (reply.data.type === 'rejected')
          return close(`DSH refused the connection: ${reply.data.code}`)
        if (reply.data.bindingId !== bindingId) return close('DSH accepted another window')
        accepted = true
        clearTimeout(handshake)
        log(`Connected to DSH for ${cwd}`)
        report('connected')
        return
      }
      const message = hostFrameSchema.safeParse(value)
      if (!message.success) return close('Invalid request from DSH')
      switch (message.data.type) {
        case 'open':
          queue.push(message.data)
          return void drain()
        case 'cwd-changed':
          return void offerReopen(message.data.cwd)
        case 'notice':
          return showError(message.data.code, message.data.message)
      }
    },
    (error) => close(`Invalid data from DSH: ${error.message}`),
  )
  return {
    connected: () => accepted && !closed,
    reconnect,
    dispose: () => close('Stopped', true),
  }
}

/**
 * Show a file with one awaited editor call. A deadline passed before that call
 * is `deadline_exceeded`; after it, the editor may still show the file, which
 * is `outcome_unknown`.
 */
async function openFile(request: OpenRequest): Promise<OpenResult> {
  let dispatched = false
  const failure = (code: OpenErrorCode, message: string): OpenResult => ({
    type: 'result',
    requestId: request.requestId,
    ok: false,
    error: { code, message },
  })
  const late = (): OpenResult | undefined => {
    if (Date.now() < request.deadline) return undefined
    return dispatched
      ? failure(
          'outcome_unknown',
          'The deadline passed after the editor was asked; it may still show the file',
        )
      : failure('deadline_exceeded', 'The deadline passed before the editor was asked')
  }
  try {
    const entry = lstatSync(request.path, { throwIfNoEntry: false })
    if (entry === undefined || entry.isSymbolicLink() || !entry.isFile()) {
      return failure('invalid_path', 'Not a regular file')
    }
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(request.path))
    const before = late()
    if (before !== undefined) return before
    // A line past the end of the file lands on its last line.
    const line = Math.min(request.line, document.lineCount) - 1
    dispatched = true
    const editor = await vscode.window.showTextDocument(document, {
      viewColumn: existingViewColumn(document.uri),
      selection: new vscode.Range(line, 0, line, 0),
      preview: false,
      preserveFocus: false,
    })
    const after = late()
    if (after !== undefined) return after
    return {
      type: 'result',
      requestId: request.requestId,
      ok: true,
      path: editor.document.uri.fsPath,
      line: editor.selection.active.line + 1,
    }
  } catch (error) {
    return late() ?? failure(dispatched ? 'show_failed' : 'open_failed', messageOf(error))
  }
}

/** Reuse the group already showing the file, preferring the active group. */
function existingViewColumn(uri: vscode.Uri): vscode.ViewColumn {
  const target = uri.toString()
  const shows = (group: vscode.TabGroup): boolean =>
    group.tabs.some(
      (tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === target,
    )
  const { activeTabGroup, all } = vscode.window.tabGroups
  if (shows(activeTabGroup)) return activeTabGroup.viewColumn
  return all.find(shows)?.viewColumn ?? vscode.ViewColumn.Active
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 2000)
}

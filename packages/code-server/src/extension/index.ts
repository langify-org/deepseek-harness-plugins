// VS Code extension, active in code-server windows the DSH page opened: it
// claims the window's binding over the host plugin's private socket and shows
// the files the page asks for in this window only.
import { lstatSync, realpathSync } from 'node:fs'
import { createConnection } from 'node:net'
import * as vscode from 'vscode'
import { z } from 'zod'
import {
  BINDING_FRAGMENT,
  SOCKET_ENV,
  frame,
  handshakeReplySchema,
  openRequestSchema,
  readFrames,
  type OpenRequest,
  type OpenResult,
} from '../protocol.ts'
import type { OpenErrorCode } from '../rpc.ts'
import { checkSocket } from './socket-check.ts'

const HANDSHAKE_TIMEOUT_MS = 10_000

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Stay silent in code-server instances DSH did not start and in windows its page did not open.
  const socketPath = process.env[SOCKET_ENV]
  if (socketPath === undefined) return
  const bindingId = await windowBinding()
  if (bindingId === undefined) return
  const output = vscode.window.createOutputChannel('DSH Code Bridge')
  context.subscriptions.push(output)
  const log = (message: string): void => output.appendLine(message)
  try {
    checkSocket(socketPath)
    context.subscriptions.push(connect(bindingId, socketPath, workspaceFolder(), log))
  } catch (error) {
    log(`Not connected: ${messageOf(error)}`)
  }
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
  log: (message: string) => void,
): vscode.Disposable {
  const socket = createConnection({ path: socketPath })
  const queue: OpenRequest[] = []
  let accepted = false
  let closed = false
  let draining = false
  const close = (reason: string): void => {
    if (closed) return
    closed = true
    queue.length = 0
    clearTimeout(handshake)
    log(reason)
    socket.destroy()
  }
  const handshake = setTimeout(() => close('No answer from DSH'), HANDSHAKE_TIMEOUT_MS)

  // Requests run one at a time; a request the editor never answers holds the rest.
  const drain = async (): Promise<void> => {
    if (draining) return
    draining = true
    for (let request = queue.shift(); request !== undefined; request = queue.shift()) {
      const result = await openFile(request)
      if (closed) break
      socket.write(frame(result))
    }
    draining = false
  }

  socket.once('connect', () => socket.write(frame({ type: 'hello', bindingId, cwd })))
  socket.on('error', (error) => close(`Connection failed: ${error.message}`))
  // Never reconnect: the page opens a new window with a new binding instead.
  socket.on('close', () => close('Disconnected from DSH. Reopen the Code tab in DSH to reconnect.'))
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
        return
      }
      const request = openRequestSchema.safeParse(value)
      if (!request.success) return close('Invalid request from DSH')
      queue.push(request.data)
      void drain()
    },
    (error) => close(`Invalid data from DSH: ${error.message}`),
  )
  return new vscode.Disposable(() => close('Stopped'))
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

// Every user-facing message, shared by the DSH page and the editor extension so
// that both say the same thing. Typed: a missing translation fails the type check.
import type { ErrorCode } from './rpc.ts'

export type MessageKey =
  // Page
  | 'title'
  | 'guide'
  | 'frame'
  | 'loading'
  | 'opening'
  | 'reconnect'
  | 'reconnect.confirm'
  | 'dismiss'
  | 'notice.ended'
  | 'queue.ended'
  | 'queue.full'
  | 'queue.expired'
  // Editor
  | 'cwd.changed'
  | 'cwd.reopen'
  | 'reconnect.unsaved'
  | 'reconnect.saveAll'
  | 'status.name'
  | 'status.connecting'
  | 'status.connected'
  | 'status.disconnected'
  | 'status.showLog'
  // Both
  | `error.${ErrorCode}`
  | 'error.unexpected'

export type Messages = Record<MessageKey, string>

export const en: Messages = {
  title: 'Code',
  guide: 'Edit the working folder in code-server',
  frame: 'code-server: {cwd}',
  loading: 'Starting code-server…',
  opening: 'Opening in Code…',
  dismiss: 'Dismiss',
  reconnect: 'Reconnect',
  'reconnect.confirm':
    'Reload the editor? Save your changes first. Files you chose before reconnecting are not reopened.',
  'notice.ended':
    'This editor connection has ended, and files are not sent to another window. Reconnect to continue.',
  'queue.ended': 'The editor connection has ended. Reconnect, then choose the file again.',
  'queue.full': 'Too many files are waiting. Choose them again once the editor is ready.',
  'queue.expired': 'A file waited too long and was dropped. Choose it again.',
  'error.invalid_path': 'Only regular files can be opened.',
  'error.deadline_exceeded': 'The editor did not open the file in time. Choose it again.',
  'error.outcome_unknown':
    'It is unknown whether the editor opened the file; it may still appear later. Nothing is resent automatically.',
  'error.open_failed': 'The editor could not read the file: {message}',
  'error.show_failed': 'The editor could not show the file: {message}',
  'error.invalid_request': 'The request was invalid: {message}',
  'error.session_not_found': 'The session no longer exists.',
  'error.session_migration_required':
    'Open this conversation once so DSH can migrate it, then try again.',
  'error.not_a_directory': 'The working folder does not exist.',
  'error.not_a_file': 'The file does not exist.',
  'error.not_a_local_file': 'Only local files open in Code.',
  'error.different_host': 'This session runs on another file system, which Code cannot open.',
  'error.code_server_not_found':
    'code-server was not found. Install it, or set its command in the plugin settings.',
  'error.code_server_failed': 'code-server failed to start: {message}',
  'error.desktop_port_in_use':
    "The editor's port for DSH Desktop is taken: {message}. Choose another one with the plugin's desktopPort setting.",
  'error.unknown_binding': 'This editor connection is gone. Reconnect.',
  'error.not_ready': 'The editor is still starting.',
  'error.binding_expired': 'The editor connection expired. Reconnect.',
  'error.binding_closed': 'The editor connection was closed. Reconnect.',
  'error.internal_error': 'The plugin failed: {message}',
  'error.unexpected': 'Something went wrong: {message}',
  'cwd.changed': "The session's working folder is now {cwd}. Reopen to edit it here.",
  'cwd.reopen': 'Reopen',
  'reconnect.unsaved': 'Some files have unsaved changes. Save them before reconnecting?',
  'reconnect.saveAll': 'Save All and Reconnect',
  'status.name': 'DeepSeek Harness connection',
  'status.connecting': 'Connecting to DeepSeek Harness…',
  'status.connected': 'Connected to DeepSeek Harness',
  'status.disconnected': 'Disconnected from DeepSeek Harness. Reconnect from the Code tab in DSH.',
  'status.showLog': 'Show the connection log',
}

export const zh: Messages = {
  title: 'Code',
  guide: '在 code-server 中编辑工作文件夹',
  frame: 'code-server：{cwd}',
  loading: '正在启动 code-server…',
  opening: '正在用 Code 打开…',
  dismiss: '关闭',
  reconnect: '重新连接',
  'reconnect.confirm': '要重新加载编辑器吗？请先保存更改。重新连接前选择的文件不会重新打开。',
  'notice.ended': '与此编辑器的连接已结束，文件不会发送到其他窗口。请重新连接以继续。',
  'queue.ended': '与编辑器的连接已结束。请重新连接，然后再次选择该文件。',
  'queue.full': '等待打开的文件过多。请在编辑器就绪后重新选择。',
  'queue.expired': '有文件等待时间过长，已被取消。请重新选择。',
  'error.invalid_path': '只能打开普通文件。',
  'error.deadline_exceeded': '编辑器未能及时打开文件。请重新选择。',
  'error.outcome_unknown': '无法确认编辑器是否打开了文件，它可能稍后才显示。不会自动重新发送。',
  'error.open_failed': '编辑器无法读取该文件：{message}',
  'error.show_failed': '编辑器无法显示该文件：{message}',
  'error.invalid_request': '请求无效：{message}',
  'error.session_not_found': '该会话已不存在。',
  'error.session_migration_required': '请先打开一次此对话，让 DSH 完成迁移，然后重试。',
  'error.not_a_directory': '工作文件夹不存在。',
  'error.not_a_file': '文件不存在。',
  'error.not_a_local_file': '只有本地文件可以在 Code 中打开。',
  'error.different_host': '此会话运行在其他文件系统上，Code 无法打开。',
  'error.code_server_not_found': '未找到 code-server。请安装它，或在插件设置中指定其命令。',
  'error.code_server_failed': 'code-server 启动失败：{message}',
  'error.desktop_port_in_use':
    '供 DSH Desktop 使用的编辑器端口已被占用：{message}。请在插件设置 desktopPort 中改用其他端口。',
  'error.unknown_binding': '与此编辑器的连接已不存在。请重新连接。',
  'error.not_ready': '编辑器仍在启动中。',
  'error.binding_expired': '与编辑器的连接已过期。请重新连接。',
  'error.binding_closed': '与编辑器的连接已关闭。请重新连接。',
  'error.internal_error': '插件出错：{message}',
  'error.unexpected': '出现问题：{message}',
  'cwd.changed': '会话的工作文件夹已变为 {cwd}。重新打开即可在此编辑。',
  'cwd.reopen': '重新打开',
  'reconnect.unsaved': '有文件尚未保存。要先保存再重新连接吗？',
  'reconnect.saveAll': '全部保存并重新连接',
  'status.name': 'DeepSeek Harness 连接',
  'status.connecting': '正在连接 DeepSeek Harness…',
  'status.connected': '已连接 DeepSeek Harness',
  'status.disconnected': '与 DeepSeek Harness 的连接已断开。请在 DSH 的 Code 标签页中重新连接。',
  'status.showLog': '显示连接日志',
}

export const ja: Messages = {
  title: 'Code',
  guide: '作業フォルダーを code-server で編集する',
  frame: 'code-server: {cwd}',
  loading: 'code-server を起動しています…',
  opening: 'Code で開いています…',
  dismiss: '閉じる',
  reconnect: '再接続',
  'reconnect.confirm':
    'エディターを再読み込みします。先に変更を保存してください。再接続前に選んだファイルは開き直しません。',
  'notice.ended':
    'このエディターとの接続は終了しました。別の画面には送りません。続けるには再接続してください。',
  'queue.ended':
    'エディターとの接続が終了しています。再接続してから、もう一度ファイルを選んでください。',
  'queue.full': '待機中のファイルが多すぎます。エディターの準備ができてから選び直してください。',
  'queue.expired': '待機が長すぎたファイルを取り消しました。もう一度選んでください。',
  'error.invalid_path': '開けるのは通常のファイルだけです。',
  'error.deadline_exceeded':
    'エディターが時間内にファイルを開けませんでした。もう一度選んでください。',
  'error.outcome_unknown':
    'エディターがファイルを開いたか確認できません。後から表示される場合があります。自動では再送しません。',
  'error.open_failed': 'エディターがファイルを読めませんでした: {message}',
  'error.show_failed': 'エディターがファイルを表示できませんでした: {message}',
  'error.invalid_request': '要求が不正です: {message}',
  'error.session_not_found': 'セッションがもう存在しません。',
  'error.session_migration_required':
    'DSH が移行できるよう、この会話を一度開いてからやり直してください。',
  'error.not_a_directory': '作業フォルダーが存在しません。',
  'error.not_a_file': 'ファイルが存在しません。',
  'error.not_a_local_file': 'Code で開けるのはローカルのファイルだけです。',
  'error.different_host':
    'このセッションは別のファイルシステムで動いているため、Code では開けません。',
  'error.code_server_not_found':
    'code-server が見つかりません。インストールするか、プラグインの設定でコマンドを指定してください。',
  'error.code_server_failed': 'code-server を起動できませんでした: {message}',
  'error.desktop_port_in_use':
    'DSH Desktop 用のエディターのポートが使われています: {message}。プラグインの設定 desktopPort で別の番号にしてください。',
  'error.unknown_binding': 'このエディターとの接続はもうありません。再接続してください。',
  'error.not_ready': 'エディターはまだ起動中です。',
  'error.binding_expired': 'エディターとの接続が期限切れになりました。再接続してください。',
  'error.binding_closed': 'エディターとの接続が閉じられました。再接続してください。',
  'error.internal_error': 'プラグインでエラーが起きました: {message}',
  'error.unexpected': '問題が起きました: {message}',
  'cwd.changed':
    'セッションの作業フォルダーが {cwd} に変わりました。開き直すとここで編集できます。',
  'cwd.reopen': '開き直す',
  'reconnect.unsaved': '保存していない変更があります。保存してから再接続しますか？',
  'reconnect.saveAll': 'すべて保存して再接続',
  'status.name': 'DeepSeek Harness との接続',
  'status.connecting': 'DeepSeek Harness に接続しています…',
  'status.connected': 'DeepSeek Harness に接続済み',
  'status.disconnected':
    'DeepSeek Harness との接続が切れました。DSH の Code タブから再接続してください。',
  'status.showLog': '接続のログを表示',
}

/** Whether a computed key, such as `error.${code}` for a code from the wire, has a message. */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(en, key)
}

/** Messages for a display language such as `ja` or `zh-cn`; English otherwise. */
export function messagesFor(language: string): Messages {
  if (language.startsWith('ja')) return ja
  if (language.startsWith('zh')) return zh
  return en
}

/** Fill `{name}` placeholders, as DSH's own translate does. */
export function format(
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  )
}

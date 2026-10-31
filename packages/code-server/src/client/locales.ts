import type { ErrorCode } from '../rpc.ts'

export const NAMESPACE = 'langify.codeServer'

export type CodeServerKey =
  | 'title'
  | 'guide'
  | 'frame'
  | 'loading'
  | 'opening'
  | 'reconnect'
  | 'dismiss'
  | 'reconnect.confirm'
  | 'cwd.changed'
  | 'notice.ended'
  | 'queue.ended'
  | 'queue.full'
  | 'queue.expired'
  | `error.${ErrorCode}`
  | 'error.unexpected'

/** Whether a computed key, such as `error.${code}` for a code from the wire, has a translation. */
export function isKey(key: string): key is CodeServerKey {
  return Object.hasOwn(en, key)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'langify.codeServer': CodeServerKey
  }
}

export const en: Record<CodeServerKey, string> = {
  title: 'Code',
  guide: 'Edit the working folder in code-server',
  frame: 'code-server: {cwd}',
  loading: 'Starting code-server…',
  opening: 'Opening in Code…',
  dismiss: 'Dismiss',
  reconnect: 'Reconnect',
  'reconnect.confirm':
    'Reload the editor? Save your changes first. Files you chose before reconnecting are not reopened.',
  'cwd.changed': 'The working folder is now {cwd}. Save your changes, then reconnect to open it.',
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
  'error.unknown_binding': 'This editor connection is gone. Reconnect.',
  'error.not_ready': 'The editor is still starting.',
  'error.binding_disconnected': 'The editor window disconnected. Reconnect.',
  'error.binding_expired': 'The editor connection expired. Reconnect.',
  'error.binding_closed': 'The editor connection was closed. Reconnect.',
  'error.internal_error': 'The plugin failed: {message}',
  'error.unexpected': 'Something went wrong: {message}',
}

export const zh: Record<CodeServerKey, string> = {
  title: 'Code',
  guide: '在 code-server 中编辑工作文件夹',
  frame: 'code-server：{cwd}',
  loading: '正在启动 code-server…',
  opening: '正在用 Code 打开…',
  dismiss: '关闭',
  reconnect: '重新连接',
  'reconnect.confirm': '要重新加载编辑器吗？请先保存更改。重新连接前选择的文件不会重新打开。',
  'cwd.changed': '工作文件夹已变为 {cwd}。请保存更改，然后重新连接以打开它。',
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
  'error.unknown_binding': '与此编辑器的连接已不存在。请重新连接。',
  'error.not_ready': '编辑器仍在启动中。',
  'error.binding_disconnected': '编辑器窗口已断开。请重新连接。',
  'error.binding_expired': '与编辑器的连接已过期。请重新连接。',
  'error.binding_closed': '与编辑器的连接已关闭。请重新连接。',
  'error.internal_error': '插件出错：{message}',
  'error.unexpected': '出现问题：{message}',
}

export const ja: Record<CodeServerKey, string> = {
  title: 'Code',
  guide: '作業フォルダーを code-server で編集する',
  frame: 'code-server: {cwd}',
  loading: 'code-server を起動しています…',
  opening: 'Code で開いています…',
  dismiss: '閉じる',
  reconnect: '再接続',
  'reconnect.confirm':
    'エディターを再読み込みします。先に変更を保存してください。再接続前に選んだファイルは開き直しません。',
  'cwd.changed': '作業フォルダーが {cwd} に変わりました。変更を保存してから再接続すると開けます。',
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
  'error.unknown_binding': 'このエディターとの接続はもうありません。再接続してください。',
  'error.not_ready': 'エディターはまだ起動中です。',
  'error.binding_disconnected': 'エディターの画面が切断されました。再接続してください。',
  'error.binding_expired': 'エディターとの接続が期限切れになりました。再接続してください。',
  'error.binding_closed': 'エディターとの接続が閉じられました。再接続してください。',
  'error.internal_error': 'プラグインでエラーが起きました: {message}',
  'error.unexpected': '問題が起きました: {message}',
}

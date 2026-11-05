// Every user-facing message. Typed: a missing translation fails the type check.

/** DSH locale namespace of this plugin's messages. */
export const NAMESPACE = 'langify.tmux'

export type MessageKey =
  | 'title'
  | 'guide'
  | 'connecting'
  | 'reconnecting'
  | 'exited'
  | 'restart'
  | 'noTmux'
  | 'copyBlocked'
  | 'copy'
  | 'dismiss'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'langify.tmux': MessageKey
  }
}

export type Messages = Record<MessageKey, string>

export const en: Messages = {
  title: 'tmux',
  guide: "The conversation's terminal, shared with the model",
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  exited: 'The terminal ended.',
  restart: 'Start again',
  noTmux: 'tmux is not installed on the host. Install it, or set the tmux plugin’s tmux path.',
  copyBlocked: 'The browser did not let tmux’s copy reach the clipboard.',
  copy: 'Copy',
  dismiss: 'Dismiss',
}

export const zh: Messages = {
  title: 'tmux',
  guide: '与模型共享的对话终端',
  connecting: '正在连接…',
  reconnecting: '正在重新连接…',
  exited: '终端已结束。',
  restart: '重新开始',
  noTmux: '主机上没有安装 tmux。请安装 tmux，或在 tmux 插件的设置中指定 tmux 的路径。',
  copyBlocked: '浏览器没有让 tmux 复制的内容进入剪贴板。',
  copy: '复制',
  dismiss: '关闭',
}

export const ja: Messages = {
  title: 'tmux',
  guide: 'モデルと共有する、会話のターミナル',
  connecting: '接続中…',
  reconnecting: '再接続中…',
  exited: 'terminal が終了しました。',
  restart: 'もう一度開く',
  noTmux:
    'host に tmux が入っていません。tmux を入れるか、tmux プラグインの設定で tmux の場所を指定してください。',
  copyBlocked: 'tmux でコピーした内容を、ブラウザがクリップボードに入れさせませんでした。',
  copy: 'コピー',
  dismiss: '閉じる',
}

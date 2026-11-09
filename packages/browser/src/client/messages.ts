// Every user-facing message. Typed: a missing translation fails the type check.

/** DSH locale namespace of this plugin's messages. */
export const NAMESPACE = 'langify.browser'

export type MessageKey =
  | 'title'
  | 'guide'
  | 'connecting'
  | 'starting'
  | 'reconnecting'
  | 'away'
  | 'show'
  | 'noXvnc'
  | 'noChromium'
  | 'failed'
  | 'retry'
  | 'unsupported'
  | 'downloaded'
  | 'save'
  | 'dismiss'
  | 'uploadAsked'
  | 'choose'
  | 'cancel'
  | 'uploading'
  | 'uploadFailed'
  | 'copyBlocked'
  | 'copy'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'langify.browser': MessageKey
  }
}

export type Messages = Record<MessageKey, string>

export const en: Messages = {
  title: 'Browser',
  guide: 'A Chromium on the host, shared with the model',
  connecting: 'Connecting…',
  starting: 'Starting the browser…',
  reconnecting: 'Reconnecting…',
  away: 'Another Browser tab is on the screen.',
  show: 'Show this one',
  noXvnc:
    'Xvnc (TigerVNC) is not installed on the host. Install it, or set the browser plugin’s xvnc path.',
  noChromium:
    'Chromium is not installed on the host. Install it, or set the browser plugin’s chromium path.',
  failed: 'The browser could not start.',
  retry: 'Try again',
  unsupported: 'This Browser tab needs DSH in a web browser.',
  downloaded: 'Downloaded',
  save: 'Save',
  dismiss: 'Dismiss',
  uploadAsked: 'The page asks for a file.',
  choose: 'Choose…',
  cancel: 'Cancel',
  uploading: 'Sending…',
  uploadFailed: 'The files could not be sent.',
  copyBlocked: 'The browser did not let the copy reach your clipboard.',
  copy: 'Copy',
}

export const ja: Messages = {
  title: 'ブラウザ',
  guide: 'ホストの Chromium。モデルと一緒に使う',
  connecting: '接続しています…',
  starting: 'ブラウザを起動しています…',
  reconnecting: '再接続しています…',
  away: '別のブラウザタブが画面に出ています。',
  show: 'このタブを表示',
  noXvnc:
    'ホストに Xvnc（TigerVNC）が入っていません。入れるか、ブラウザプラグインの xvnc にパスを設定してください。',
  noChromium:
    'ホストに Chromium が入っていません。入れるか、ブラウザプラグインの chromium にパスを設定してください。',
  failed: 'ブラウザを起動できませんでした。',
  retry: 'もう一度',
  unsupported: 'このブラウザタブは、Web ブラウザで開いた DSH でだけ使えます。',
  downloaded: 'ダウンロードしました',
  save: '保存',
  dismiss: '閉じる',
  uploadAsked: 'ページがファイルを求めています。',
  choose: '選ぶ…',
  cancel: 'やめる',
  uploading: '送っています…',
  uploadFailed: 'ファイルを送れませんでした。',
  copyBlocked: 'ブラウザがコピーをクリップボードに入れさせませんでした。',
  copy: 'コピー',
}

export const zh: Messages = {
  title: '浏览器',
  guide: '主机上的 Chromium，与模型共用',
  connecting: '正在连接…',
  starting: '正在启动浏览器…',
  reconnecting: '正在重新连接…',
  away: '屏幕上显示的是另一个浏览器标签页。',
  show: '显示这一个',
  noXvnc: '主机上没有安装 Xvnc（TigerVNC）。请安装，或设置浏览器插件的 xvnc 路径。',
  noChromium: '主机上没有安装 Chromium。请安装，或设置浏览器插件的 chromium 路径。',
  failed: '浏览器无法启动。',
  retry: '重试',
  unsupported: '此浏览器标签页需要在网页浏览器中打开的 DSH。',
  downloaded: '已下载',
  save: '保存',
  dismiss: '关闭',
  uploadAsked: '页面需要一个文件。',
  choose: '选择…',
  cancel: '取消',
  uploading: '正在发送…',
  uploadFailed: '文件无法发送。',
  copyBlocked: '浏览器未允许将复制的内容放入剪贴板。',
  copy: '复制',
}

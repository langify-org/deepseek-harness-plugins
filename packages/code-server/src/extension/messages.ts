// Status bar copy in the languages the plugin supports, typed so that a missing
// translation fails the type check.
type Key = 'name' | 'connecting' | 'connected' | 'disconnected' | 'showLog'

const en: Record<Key, string> = {
  name: 'DeepSeek Harness connection',
  connecting: 'Connecting to DeepSeek Harness…',
  connected: 'Connected to DeepSeek Harness',
  disconnected: 'Disconnected from DeepSeek Harness. Reconnect from the Code tab in DSH.',
  showLog: 'Show the connection log',
}

const ja: Record<Key, string> = {
  name: 'DeepSeek Harness との接続',
  connecting: 'DeepSeek Harness に接続しています…',
  connected: 'DeepSeek Harness に接続済み',
  disconnected: 'DeepSeek Harness との接続が切れました。DSH の Code タブから再接続してください。',
  showLog: '接続のログを表示',
}

const zh: Record<Key, string> = {
  name: 'DeepSeek Harness 连接',
  connecting: '正在连接 DeepSeek Harness…',
  connected: '已连接 DeepSeek Harness',
  disconnected: '与 DeepSeek Harness 的连接已断开。请在 DSH 的 Code 标签页中重新连接。',
  showLog: '显示连接日志',
}

/** Messages for a VS Code display language such as `ja` or `zh-cn`; English otherwise. */
export function messages(language: string): Record<Key, string> {
  if (language.startsWith('ja')) return ja
  if (language.startsWith('zh')) return zh
  return en
}

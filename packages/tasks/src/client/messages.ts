// Every user-facing message. Typed: a missing translation fails the type check.
import type { ErrorCode } from '../rpc.ts'

/** DSH locale namespace of this plugin's messages. */
export const NAMESPACE = 'langify.tasks'

export type MessageKey =
  | 'title'
  | 'guide'
  | 'loading'
  | 'run'
  | 'running'
  | 'runHint'
  | 'from'
  | 'noJustfile'
  | 'noRecipes'
  | 'optional'
  | 'values'
  | 'missing'
  | 'control'
  | `error.${ErrorCode}`
  | 'error.terminal'
  | 'error.unexpected'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'langify.tasks': MessageKey
  }
}

export type Messages = Record<MessageKey, string>

export const en: Messages = {
  title: 'Tasks',
  guide: 'Run a justfile recipe in a terminal',
  loading: 'Reading the justfile…',
  run: 'Run',
  running: 'Starting…',
  runHint: 'Enter to run · Esc to close',
  from: 'From {path}',
  noJustfile: 'No justfile in this folder or above it.',
  noRecipes: 'The justfile has no public recipes.',
  optional: 'optional',
  values: 'space-separated',
  missing: 'Fill in {name}.',
  control: '{name} contains a control character.',
  'error.invalid_request': 'The request was invalid: {message}',
  'error.session_not_found': 'The session was not found: {message}',
  'error.just_not_found': '`just` is not installed on the host.',
  'error.just_failed': 'just could not read the justfile: {message}',
  'error.internal_error': 'Something went wrong: {message}',
  'error.terminal': 'The terminal could not start: {message}',
  'error.unexpected': 'Something went wrong: {message}',
}

export const zh: Messages = {
  title: '任务',
  guide: '在终端中运行 justfile 的 recipe',
  loading: '正在读取 justfile…',
  run: '运行',
  running: '正在启动…',
  runHint: '回车运行 · Esc 关闭',
  from: '来自 {path}',
  noJustfile: '此文件夹及其上级中没有 justfile。',
  noRecipes: 'justfile 中没有公开的 recipe。',
  optional: '可选',
  values: '用空格分隔',
  missing: '请填写 {name}。',
  control: '{name} 中包含控制字符。',
  'error.invalid_request': '请求无效：{message}',
  'error.session_not_found': '找不到会话：{message}',
  'error.just_not_found': '主机上没有安装 `just`。',
  'error.just_failed': 'just 无法读取 justfile：{message}',
  'error.internal_error': '出现错误：{message}',
  'error.terminal': '终端无法启动：{message}',
  'error.unexpected': '出现错误：{message}',
}

export const ja: Messages = {
  title: 'タスク',
  guide: 'justfile の recipe を terminal で実行する',
  loading: 'justfile を読んでいます…',
  run: '実行',
  running: '開始しています…',
  runHint: 'Enter で実行 · Esc で閉じる',
  from: '{path} から',
  noJustfile: 'このフォルダにも上のフォルダにも justfile がありません。',
  noRecipes: 'justfile に公開の recipe がありません。',
  optional: '省略可',
  values: 'スペース区切り',
  missing: '{name} を入力してください。',
  control: '{name} に制御文字が入っています。',
  'error.invalid_request': 'リクエストが正しくありません：{message}',
  'error.session_not_found': 'session が見つかりません：{message}',
  'error.just_not_found': 'Host に `just` が入っていません。',
  'error.just_failed': 'just が justfile を読めませんでした：{message}',
  'error.internal_error': 'エラーが起きました：{message}',
  'error.terminal': 'terminal を開けませんでした：{message}',
  'error.unexpected': 'エラーが起きました：{message}',
}

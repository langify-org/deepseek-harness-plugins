// Every user-facing message. Typed: a missing translation fails the type check.
import type { ErrorCode } from '../rpc.ts'

/** DSH locale namespace of this plugin's messages. */
export const NAMESPACE = 'langify.sideChat'

export type MessageKey = 'title' | 'action' | `error.${ErrorCode}` | 'error.unexpected'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'langify.sideChat': MessageKey
  }
}

export type Messages = Record<MessageKey, string>

export const en: Messages = {
  title: 'Side chat',
  action: 'Ask in a side chat',
  'error.invalid_request': 'The request was invalid: {message}',
  'error.fork_failed': 'The side chat could not start: {message}',
  'error.internal_error': 'Something went wrong: {message}',
  'error.unexpected': 'Something went wrong: {message}',
}

export const zh: Messages = {
  title: '旁路对话',
  action: '在旁路对话中提问',
  'error.invalid_request': '请求无效：{message}',
  'error.fork_failed': '旁路对话启动失败：{message}',
  'error.internal_error': '出现错误：{message}',
  'error.unexpected': '出现错误：{message}',
}

export const ja: Messages = {
  title: 'サイドチャット',
  action: 'サイドチャットで質問する',
  'error.invalid_request': 'リクエストが正しくありません：{message}',
  'error.fork_failed': 'サイドチャットを始められませんでした：{message}',
  'error.internal_error': 'エラーが起きました：{message}',
  'error.unexpected': 'エラーが起きました：{message}',
}

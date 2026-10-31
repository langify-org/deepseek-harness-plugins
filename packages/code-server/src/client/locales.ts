import type { MessageKey } from '../messages.ts'

/** DSH locale namespace of this plugin's messages (see ../messages.ts). */
export const NAMESPACE = 'langify.codeServer'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'langify.codeServer': MessageKey
  }
}

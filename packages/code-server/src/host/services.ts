import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import type { SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'

/** The DSH host services this plugin injects. */
export interface Services {
  readonly connection: HostConnectionHandle
  readonly webServer: WebServer
  readonly subprocess: SubprocessRuntime
  readonly fs: FileSystem
  readonly sessions: SessionStore
  readonly workingDirectory: WorkingDirectoryService
  readonly sessionController: SessionController
  readonly sessionPersistence: SessionPersistence
}

export const inject: readonly (keyof Services)[] = [
  'connection',
  'webServer',
  'subprocess',
  'fs',
  'sessions',
  'workingDirectory',
  'sessionController',
  'sessionPersistence',
]

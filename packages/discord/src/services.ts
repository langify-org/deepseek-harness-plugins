import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import type { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import type { WorkspaceRegistry } from '@deepseek-ai/dsh-workspace'

/**
 * The DSH host services this plugin injects. `approval` is not called: naming
 * it loads the `approval/request` event this plugin answers.
 */
export interface Services {
  readonly credentials: CredentialProvider
  readonly sessionController: SessionController
  readonly agents: AgentRegistry
  readonly userQuestions: UserQuestionService
  readonly workspaceRegistry: WorkspaceRegistry
  readonly approval?: ApprovalService
}

export const inject: readonly (keyof Services)[] = [
  'credentials',
  'sessionController',
  'agents',
  'userQuestions',
  'workspaceRegistry',
]

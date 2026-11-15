// Registers Exa as a search provider and a fetch provider of DSH's web
// capability (ctx.web), so web_search and web_fetch run on Exa alone.
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type { WebFetchProvider, WebSearchProvider } from '@deepseek-ai/dsh-web'
import Schema from '@deepseek-ai/schemastery'
import { exaFetch, exaSearch } from './exa.ts'

export const name = 'langify-exa'

/** The DSH host services this plugin injects. */
export interface Services {
  readonly web: {
    registerSearchProvider(provider: WebSearchProvider): unknown
    registerFetchProvider(provider: WebFetchProvider): unknown
  }
}

export const inject: readonly (keyof Services)[] = ['web']

export interface Config {
  apiKeyEnv: string
}

export const Config: Schema<Config> = Schema.object({
  apiKeyEnv: Schema.string()
    .default('EXA_API_KEY')
    .description('The environment variable that holds the Exa API key.'),
})

export function apply(ctx: Context & Services, config: Config): void {
  const apiKey = launchEnvironmentOf(ctx).get(config.apiKeyEnv)?.value ?? ''
  ctx.web.registerSearchProvider(exaSearch(apiKey))
  ctx.web.registerFetchProvider(exaFetch(apiKey))
}

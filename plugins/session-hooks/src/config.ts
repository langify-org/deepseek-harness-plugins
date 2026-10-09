/**
 * Configuration of the session hooks plugin: which shell commands run on which
 * session lifecycle event, and how they run.
 */
import Schema from '@deepseek-ai/schemastery'

/** The `agent/created` sources DSH reports; `startup` is a freshly created session. */
export const START_SOURCES = ['startup', 'resume', 'clear', 'compact'] as const
export type StartSource = (typeof START_SOURCES)[number]

/** One configured command after normalization. */
export interface HookCommand {
  /** Shell source, run as `<shell> -c <command>`. */
  readonly command: string
  /** Per-command timeout in milliseconds; falls back to `defaultTimeoutMs`. */
  readonly timeoutMs?: number
}

/** A command as written in YAML: either the bare command string or an object. */
export type HookCommandInput = string | { command: string; timeoutMs?: number }

/** The configuration as written in a patch layer. Every field is optional. */
export interface ConfigInput {
  sessionStart?: HookCommandInput[]
  sessionArchive?: HookCommandInput[]
  sessionUnarchive?: HookCommandInput[]
  startSources?: StartSource[]
  includeSubagents?: boolean
  defaultTimeoutMs?: number
  stateDir?: string
  shell?: string
}

/** The validated configuration the plugin runs with. */
export interface SessionHooksConfig {
  readonly sessionStart: readonly HookCommand[]
  readonly sessionArchive: readonly HookCommand[]
  readonly sessionUnarchive: readonly HookCommand[]
  readonly startSources: readonly StartSource[]
  readonly includeSubagents: boolean
  readonly defaultTimeoutMs: number
  /** Where per-session records live; defaults to `$DSH_HOME/langify-session-hooks`. */
  readonly stateDir?: string
  readonly shell: string
}

export const DEFAULT_TIMEOUT_MS = 60_000

const hookCommand = Schema.union([
  Schema.string(),
  Schema.object({
    command: Schema.string().required().description('Shell command to run.'),
    timeoutMs: Schema.natural().description('Timeout for this command, in milliseconds.'),
  }),
])

const hookList = (description: string) => Schema.array(hookCommand).default([]).description(description)

/**
 * Loader-facing schema. DSH uses it to fill defaults and to describe the
 * plugin's settings; {@link resolveConfig} applies the same rules again so the
 * plugin never depends on whether the host ran it.
 */
export const Config: Schema<ConfigInput> = Schema.object({
  sessionStart: hookList('Commands run when a session starts, before its first model request.'),
  sessionArchive: hookList('Commands run after a session is archived.'),
  sessionUnarchive: hookList('Commands run after an archived session is restored.'),
  startSources: Schema.array(Schema.union(START_SOURCES.map((source) => Schema.const(source))))
    .default(['startup'])
    .description('Which session starts run `sessionStart`: startup (new session), resume, clear, compact.'),
  includeSubagents: Schema.boolean()
    .default(false)
    .description('Also run hooks for subagent and teammate sessions.'),
  defaultTimeoutMs: Schema.natural()
    .default(DEFAULT_TIMEOUT_MS)
    .description('Timeout for commands that set none, in milliseconds.'),
  stateDir: Schema.string().description('Directory for per-session records. Defaults to $DSH_HOME/langify-session-hooks.'),
  shell: Schema.string().default('bash').description('Shell executable; commands run as `<shell> -c <command>`.'),
})

/**
 * Validate a raw config value and normalize it.
 * @param raw - the row's `config`, as composed by the loader (possibly `undefined`).
 * @returns the validated configuration.
 * @throws Error with a `langify-session-hooks:` prefix for an invalid value.
 */
export function resolveConfig(raw: unknown): SessionHooksConfig {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error('langify-session-hooks: config must be a mapping')
  }
  const input = (raw ?? {}) as ConfigInput
  const defaultTimeoutMs = input.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
  assertPositiveInteger('defaultTimeoutMs', defaultTimeoutMs)
  const shell = input.shell ?? 'bash'
  if (typeof shell !== 'string' || shell.trim() === '') throw new Error('langify-session-hooks: shell must be a non-empty string')
  const stateDir = input.stateDir
  if (stateDir !== undefined && (typeof stateDir !== 'string' || stateDir === '')) {
    throw new Error('langify-session-hooks: stateDir must be a non-empty string')
  }
  const includeSubagents = input.includeSubagents ?? false
  if (typeof includeSubagents !== 'boolean') throw new Error('langify-session-hooks: includeSubagents must be a boolean')
  return {
    sessionStart: commands('sessionStart', input.sessionStart),
    sessionArchive: commands('sessionArchive', input.sessionArchive),
    sessionUnarchive: commands('sessionUnarchive', input.sessionUnarchive),
    startSources: sources(input.startSources),
    includeSubagents,
    defaultTimeoutMs,
    ...(stateDir !== undefined ? { stateDir } : {}),
    shell,
  }
}

function commands(field: string, value: unknown): HookCommand[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new Error(`langify-session-hooks: ${field} must be a list of commands`)
  return value.map((entry, index) => {
    const where = `${field}[${index}]`
    if (typeof entry === 'string') {
      if (entry.trim() === '') throw new Error(`langify-session-hooks: ${where} is an empty command`)
      return { command: entry }
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`langify-session-hooks: ${where} must be a command string or { command, timeoutMs }`)
    }
    const { command, timeoutMs } = entry as { command?: unknown; timeoutMs?: unknown }
    if (typeof command !== 'string' || command.trim() === '') {
      throw new Error(`langify-session-hooks: ${where}.command must be a non-empty string`)
    }
    if (timeoutMs === undefined || timeoutMs === null) return { command }
    assertPositiveInteger(`${where}.timeoutMs`, timeoutMs)
    return { command, timeoutMs }
  })
}

function sources(value: unknown): StartSource[] {
  if (value === undefined || value === null) return ['startup']
  if (!Array.isArray(value)) throw new Error('langify-session-hooks: startSources must be a list')
  for (const source of value) {
    if (!(START_SOURCES as readonly unknown[]).includes(source)) {
      throw new Error(`langify-session-hooks: unknown start source ${JSON.stringify(source)} (expected one of ${START_SOURCES.join(', ')})`)
    }
  }
  return [...new Set(value as StartSource[])]
}

function assertPositiveInteger(field: string, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`langify-session-hooks: ${field} must be a positive integer (milliseconds)`)
  }
}

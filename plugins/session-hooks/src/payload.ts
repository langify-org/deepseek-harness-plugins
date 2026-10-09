/**
 * What a hook command receives: a JSON payload on stdin and the same facts as
 * environment variables. Field names follow Claude Code's hook payloads where
 * the meaning is the same (`hook_event_name`, `session_id`, `cwd`, `source`).
 */
import type { StartSource } from './config.ts'

export type HookEventName = 'SessionStart' | 'SessionArchive' | 'SessionUnarchive'

export interface HookPayload {
  readonly hook_event_name: HookEventName
  readonly session_id: string
  /** The directory the session was created in; it never changes. `null` when unrecorded. */
  readonly cwd: string | null
  /**
   * The directory a `sessionStart` command chose for this session, when one did.
   * Later start commands see the choice of earlier ones.
   */
  readonly workdir: string | null
  /** `SessionStart` only: why the session started. */
  readonly source?: StartSource
  /** Set when the session was forked from another one. */
  readonly parent_session_id?: string
  /** `subagent` for subagent and teammate sessions. */
  readonly origin?: string
}

/** Variables this plugin owns; inherited values are removed so they never leak into a hook. */
const OWNED = ['DSH_HOOK_EVENT', 'DSH_HOOK_SOURCE', 'DSH_SESSION_ID', 'DSH_SESSION_CWD', 'DSH_SESSION_WORKDIR'] as const

/**
 * The hook's environment: the DSH process environment plus the payload facts.
 * @param base - the environment to inherit (normally `process.env`).
 * @param payload - the event payload.
 */
export function hookEnv(base: NodeJS.ProcessEnv, payload: HookPayload): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const key of OWNED) delete env[key]
  env.DSH_HOOK_EVENT = payload.hook_event_name
  env.DSH_SESSION_ID = payload.session_id
  if (payload.cwd !== null) env.DSH_SESSION_CWD = payload.cwd
  if (payload.workdir !== null) env.DSH_SESSION_WORKDIR = payload.workdir
  if (payload.source !== undefined) env.DSH_HOOK_SOURCE = payload.source
  return env
}

/** The stdin document: one line of JSON. */
export function hookStdin(payload: HookPayload): string {
  return `${JSON.stringify(payload)}\n`
}

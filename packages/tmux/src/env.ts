// The host process's environment as tmux sees it. Pure.

/** Names DSH keeps from the processes it starts (dsh-subprocess's SENSITIVE_ENV_PATTERN). */
const SENSITIVE_NAME = /KEY|PASSWORD|SECRET|TOKEN/i

/**
 * The environment for tmux: the host's, without sensitive names and DSH's
 * own `DSH_*` variables, as DSH gives its terminals. A tmux server started
 * from the host would otherwise hand the host's API keys to every shell.
 */
export function scrubEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).flatMap(([name, value]) =>
      value === undefined || SENSITIVE_NAME.test(name) || name.startsWith('DSH_')
        ? []
        : [[name, value]],
    ),
  )
}

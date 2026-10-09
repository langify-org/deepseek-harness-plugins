# @langify-org/dsh-session-hooks

English | [日本語](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/README.ja.md) | [简体中文](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/README.zh.md)

Run your own shell commands when a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) session starts, is archived, or is restored. Typical uses: give every session its own git worktree, prepare or clean up resources, or keep an external tracker in sync.

| Event | When it runs | What the command can do |
|---|---|---|
| `sessionStart` | A new session is created, before its first model request | Prepare things, and print `{"workdir": ..., "context": ...}` to point the session at a directory and tell the model about it |
| `sessionArchive` | After a session is archived | Clean up or archive resources |
| `sessionUnarchive` | After an archived session is restored | Bring resources back |

Requires DSH `0.2.x` and a POSIX shell (Linux or macOS).

## Status

**Experimental.** Until 1.0, the configuration and what commands receive may change between minor versions; the changelog says when.

- Built and tested against DSH `0.2.0-rc.2` on Linux. macOS should work but has not been tested. Windows is not supported.
- Archive and unarchive hooks depend on DSH internals. DSH has no archive event, so the plugin watches the archive list the workspace registry stores (see "How it works"). A DSH update can change that; archive hooks would then stop running without an error. The repository's end-to-end test checks this against the DSH version it targets.
- A start command's `workdir` is a note to the model, not a real change of the session's directory (see "Pointing a session at another directory").

## Install

**From npm** (any DSH installation):

```sh
dsh plugin --profile web add @langify-org/dsh-session-hooks
```

Or install it by name from the Web UI's **Plugins** page. pnpm's `Issues with peer dependencies found` warning during installation is expected: DSH supplies the `@deepseek-ai/*` peers itself.

**With `--patch`** (no profile change; used by Nix setups): point `dsh` at the bundle's own patch file. Its plugin path is relative to the file, so this works from an unpacked package or a checkout:

```sh
dsh web --patch /path/to/dsh-session-hooks/cordis.patch.yml --patch ./my-hooks.patch.yml
```

A plugin loaded this way must find DSH's own `@deepseek-ai/*` modules through Node's normal lookup. The Nix flake in this repository does that for you (`lib.mkPlugins`, see the [repository README](https://github.com/langify-org/deepseek-harness-plugins#nix)).

Installing adds the plugin but runs nothing until you configure hooks.

## Configure

Add a row to your profile's patch layer, `$DSH_HOME/profiles/<profile>/cordis.patch.yml` (or to a later `--patch` file). The row replaces the plugin's whole `config`, so list every key you use:

```yaml
- id: langify-session-hooks
  config:
    sessionStart:
      - ~/.config/dsh/hooks/start.sh
    sessionArchive:
      - command: ~/.config/dsh/hooks/archive.sh
        timeoutMs: 120000
    sessionUnarchive:
      - ~/.config/dsh/hooks/unarchive.sh
```

In the default `web` profile, saving the profile's `cordis.patch.yml` applies the change. Profiles without HMR, and `--patch` files, need a restart.

| Key | Default | Meaning |
|---|---|---|
| `sessionStart`, `sessionArchive`, `sessionUnarchive` | `[]` | Commands for each event: a string, or `{ command, timeoutMs }`. They run one after another, in order. |
| `startSources` | `[startup]` | Which session starts run `sessionStart`: `startup` (new session), `resume`, `clear`, `compact`. |
| `includeSubagents` | `false` | Also run hooks for subagent and teammate sessions. |
| `defaultTimeoutMs` | `60000` | Timeout for a command that sets none. |
| `shell` | `bash` | Commands run as `<shell> -c <command>`. |
| `stateDir` | `$DSH_HOME/langify-session-hooks` | Where per-session records and `hooks.log` live. |

## What a command receives

Each command runs in the session's directory (or DSH's own directory if that no longer exists), with one line of JSON on stdin:

```json
{"hook_event_name":"SessionStart","session_id":"session-…","cwd":"/home/me/project","workdir":null,"source":"startup"}
```

| Field | Meaning |
|---|---|
| `hook_event_name` | `SessionStart`, `SessionArchive`, or `SessionUnarchive` |
| `session_id` | The DSH session id |
| `cwd` | The directory the session was created in |
| `workdir` | The directory a start command chose (see below), or `null`. Archive and unarchive commands get the one recorded at start, even after DSH restarts. |
| `source` | `SessionStart` only: `startup`, `resume`, `clear`, or `compact` |
| `parent_session_id`, `origin` | Present for forked sessions, and for subagents (`origin: "subagent"`) |

The same facts are in the environment: `DSH_HOOK_EVENT`, `DSH_SESSION_ID`, `DSH_SESSION_CWD`, `DSH_SESSION_WORKDIR`, and `DSH_HOOK_SOURCE`, on top of DSH's own environment. Field names follow Claude Code's hook payloads where the meaning is the same.

## Pointing a session at another directory

DSH fixes a session's directory when the session is created; a hook cannot change it. A `sessionStart` command can instead print a JSON object, as its whole output or as its last line:

```json
{"workdir": "/home/me/.local/share/dsh-worktrees/project/session-…", "context": "Branch dsh/session-… was created for you."}
```

- `workdir` must be an existing directory. The plugin tells the model to work there (to run commands in it and edit files under it), and passes it to later start commands and to the session's archive and unarchive commands.
- `context` is extra text for the model.

The plugin adds this as one note before the session's first model request. The Web UI's file panel and the session's place in the sidebar still follow the original directory.

## Example: one git worktree per session

[`examples/`](https://github.com/langify-org/deepseek-harness-plugins/tree/main/plugins/session-hooks/examples) holds three scripts that work together:

- [`worktree-start.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-start.sh) creates a worktree on a new branch `dsh/<session id>` when the session opens inside a git repository, and prints it as the `workdir`.
- [`worktree-archive.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-archive.sh) removes that worktree on archive, but only when it has no uncommitted changes. The branch is kept.
- [`worktree-unarchive.sh`](https://github.com/langify-org/deepseek-harness-plugins/blob/main/plugins/session-hooks/examples/worktree-unarchive.sh) recreates the worktree from the branch on restore.

```yaml
- id: langify-session-hooks
  config:
    sessionStart:
      - bash /path/to/dsh-session-hooks/examples/worktree-start.sh
    sessionArchive:
      - bash /path/to/dsh-session-hooks/examples/worktree-archive.sh
    sessionUnarchive:
      - bash /path/to/dsh-session-hooks/examples/worktree-unarchive.sh
```

After `dsh plugin add`, the scripts are in `$DSH_HOME/profiles/<profile>/node_modules/@langify-org/dsh-session-hooks/examples/`. Run them with `bash` as shown, because package managers do not keep their executable bit, or copy them somewhere of your own and adapt them. Worktrees go to `$DSH_WORKTREES_DIR` (default `~/.local/share/dsh-worktrees`). The repository's end-to-end test runs exactly these scripts against a real DSH.

## Failures and logs

- A command that exits non-zero, times out, or cannot start is reported, and DSH carries on. A failed start command contributes no `workdir` or `context`; the next command still runs.
- Every run is appended to `<stateDir>/hooks.log` as JSON Lines: event, session, status, exit code, duration, and the tail of stdout and stderr. Failures are also printed to DSH's stderr as `[langify-session-hooks] …`, which you see in the terminal or in your service log.
- `sessionStart` delays the session's creation until its commands finish, so keep them quick and set `timeoutMs` for slow ones.
- When DSH stops or reloads the plugin, running commands are stopped (SIGTERM, then SIGKILL after 3 s). Write archive scripts so that running them again is safe.
- A command's background processes that keep running after it exits are not waited for and not stopped. Redirect their output, for example `nohup task >/dev/null 2>&1 &`.

## Security

Commands run with the DSH process's own permissions, outside the agent sandbox, like Claude Code hooks. They come only from your patch layers: the plugin never reads hook configuration from a project directory, so opening a session in a cloned repository does not run that repository's code.

## How it works

- **Start:** DSH emits `agent/created` when it creates a session. The plugin awaits its commands in that listener, so they finish before the first request, and then calls `agent.inject()` with a `notice` note.
- **Archive and restore:** DSH has no archive event. The workspace registry stores the archive set in its storage domain, and each durable write emits `domain/changed` with the new set. The plugin diffs consecutive sets. Sessions archived before the plugin started never fire hooks.
- Hooks for the same session run in order; hooks for different sessions run concurrently.

## License

MIT

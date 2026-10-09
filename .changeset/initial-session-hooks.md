---
"@langify-org/dsh-session-hooks": patch
---

First (experimental) release: run shell commands when a session starts, is archived, or is restored. Commands come from your DSH config, or from a project's own `.dsh/hooks.yml` when the project is under a directory listed in `projectHooks.trustedDirs`. Start commands can point the session at a working directory such as a per-session git worktree, and every run is recorded in `hooks.log`. The README is available in English, Japanese, and Simplified Chinese.

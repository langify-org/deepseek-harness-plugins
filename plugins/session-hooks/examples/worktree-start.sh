#!/usr/bin/env bash
# sessionStart example: give every new DSH session its own git worktree.
#
# When the session was opened inside a git repository, create a worktree on a
# new branch `dsh/<session id>` and print it as the session's workdir. Outside
# a repository it does nothing.
#
# Worktrees go to $DSH_WORKTREES_DIR/<repo name>/<session id>
# (default: ${XDG_DATA_HOME:-~/.local/share}/dsh-worktrees).
set -euo pipefail

cat >/dev/null # the JSON payload; this script uses the DSH_* variables instead

json_string() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

session_id=${DSH_SESSION_ID:?}
cwd=${DSH_SESSION_CWD:-}
[ -n "$cwd" ] || exit 0
repo=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0

base=${DSH_WORKTREES_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/dsh-worktrees}
worktree="$base/$(basename "$repo")/$session_id"
branch="dsh/$session_id"
from=$(git -C "$repo" rev-parse --abbrev-ref HEAD)

mkdir -p "$(dirname "$worktree")"
git -C "$repo" worktree add -b "$branch" "$worktree" HEAD >&2

# Keep the session's position inside the repository (a session opened in
# <repo>/app works in <worktree>/app).
relative=${cwd#"$repo"}
workdir="$worktree$relative"
[ -d "$workdir" ] || workdir=$worktree

printf '{"workdir": %s, "context": %s}\n' \
  "$(json_string "$workdir")" \
  "$(json_string "Git branch $branch was created from $from for this session; commit your work there.")"

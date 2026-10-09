#!/usr/bin/env bash
# sessionUnarchive example: restore the worktree `worktree-archive.sh` removed.
#
# Recreates it from the kept `dsh/<session id>` branch at the same path, so the
# workdir the session was told about is valid again.
set -euo pipefail

cat >/dev/null

session_id=${DSH_SESSION_ID:?}
workdir=${DSH_SESSION_WORKDIR:-}
cwd=${DSH_SESSION_CWD:-}
[ -n "$workdir" ] && [ -n "$cwd" ] || exit 0
[ -e "$workdir" ] && exit 0
repo=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || exit 0

branch="dsh/$session_id"
git -C "$repo" rev-parse --verify --quiet "refs/heads/$branch" >/dev/null || exit 0

base=${DSH_WORKTREES_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/dsh-worktrees}
worktree="$base/$(basename "$repo")/$session_id"
case "$workdir" in
  "$worktree" | "$worktree"/*) ;;
  *) exit 0 ;; # not a worktree this example created
esac

git -C "$repo" worktree prune
git -C "$repo" worktree add "$worktree" "$branch" >&2
echo "restored worktree $worktree" >&2

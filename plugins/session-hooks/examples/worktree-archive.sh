#!/usr/bin/env bash
# sessionArchive example: remove the session's worktree when nothing would be lost.
#
# The branch is always kept, so `worktree-unarchive.sh` can bring the worktree
# back. A worktree with uncommitted changes is left in place.
set -euo pipefail

cat >/dev/null

workdir=${DSH_SESSION_WORKDIR:-}
[ -n "$workdir" ] && [ -d "$workdir" ] || exit 0
worktree=$(git -C "$workdir" rev-parse --show-toplevel 2>/dev/null) || exit 0

# Only linked worktrees; never the main checkout.
common=$(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir)
own=$(git -C "$worktree" rev-parse --path-format=absolute --git-dir)
[ "$common" != "$own" ] || exit 0

if [ -n "$(git -C "$worktree" status --porcelain)" ]; then
  echo "worktree $worktree has uncommitted changes; left in place" >&2
  exit 0
fi

git -C "$worktree" worktree remove "$worktree"
echo "removed worktree $worktree (its branch is kept)" >&2

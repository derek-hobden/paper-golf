#!/usr/bin/env bash
# PreToolUse guard: refuse to change files in a checkout that is on main/master.
#
# AGENTS.md: every change is a pull request to main and nothing ever pushes to
# main. Nothing enforced working on a branch, so an edit made straight on the
# primary checkout's main was one `git push` away from a refused push or a lost
# change. This hook makes the rule real for edits.
#
# Wired in .claude/settings.json as a PreToolUse hook matching
# Edit|Write|NotebookEdit (tests/claude-no-prompts.test.ts pins
# that). It reads the PreToolUse JSON payload on stdin, finds the git checkout
# that owns the file being edited, and blocks (exit 2, reason on stderr) when
# that checkout is on main or master.
#
# Fail-soft by design: any ambiguity (no git, not a repo, unparseable payload)
# exits 0 so the hook never wedges an edit it can't reason about. Set
# CLAUDE_ALLOW_MAIN_EDITS=1 to deliberately allow a main edit (the rare
# work-in-place session).
set -uo pipefail

# Explicit escape hatch for intentional work-in-place sessions.
[ "${CLAUDE_ALLOW_MAIN_EDITS:-}" = "1" ] && exit 0

payload=$(cat)

# Pull a string field out of the payload. Grep keeps this dependency-free (no
# jq); good enough for the flat, well-formed payload the harness sends.
field() {
  printf '%s' "$payload" |
    grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" |
    head -1 |
    sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'
}

# Edit/Write send file_path; NotebookEdit sends notebook_path. Fall back to
# the session cwd if neither is there.
file_path=$(field file_path)
[ -n "$file_path" ] || file_path=$(field notebook_path)
if [ -n "$file_path" ]; then
  target_dir=$(dirname "$file_path")
else
  target_dir=$(field cwd)
fi
[ -n "$target_dir" ] || exit 0

# A Write can create a file several directories deep; climb to the nearest
# directory that exists so git can tell which checkout it belongs to.
while [ ! -d "$target_dir" ] && [ "$target_dir" != "/" ] && [ "$target_dir" != "." ]; do
  target_dir=$(dirname "$target_dir")
done
[ -d "$target_dir" ] || exit 0

command -v git >/dev/null 2>&1 || exit 0

# --show-current resolves the worktree's own branch, so an edit in a feature
# worktree is allowed even while the primary checkout sits on main.
branch=$(git -C "$target_dir" branch --show-current 2>/dev/null) || exit 0
[ -n "$branch" ] || exit 0

case "$branch" in
  main | master)
    # Gitignored paths are runtime state (.env.local, caches, scratch), not
    # commit material, so the branch rule doesn't apply. Allow only on an
    # explicit "ignored" verdict (exit 0); anything else falls through.
    if [ -n "$file_path" ] && git -C "$target_dir" check-ignore -q -- "$file_path" 2>/dev/null; then
      exit 0
    fi
    # Repo name for the message: $GITHUB_REPOSITORY (owner/name) when set,
    # else the origin remote, else the checkout's directory name.
    repo="${GITHUB_REPOSITORY:-}"
    if [ -z "$repo" ]; then
      repo=$(git -C "$target_dir" remote get-url origin 2>/dev/null | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')
    fi
    [ -n "$repo" ] || repo=$(basename "$(git -C "$target_dir" rev-parse --show-toplevel 2>/dev/null || echo "$target_dir")")
    repo_name=${REPO_DISPLAY_NAME:-${repo##*/}} # e.g. REPO_DISPLAY_NAME=paper-golf
    echo "🛑 Blocked: this checkout ($target_dir) is on '$branch'." >&2
    echo "$repo_name work happens on a branch or worktree and reaches main only through" >&2
    echo "a pull request (AGENTS.md, Ship process). Isolate it first:" >&2
    echo "  • background/agent session → EnterWorktree, then edit there" >&2
    echo "  • interactive session       → git switch -c <branch>" >&2
    echo "Deliberate work-in-place? Re-run with CLAUDE_ALLOW_MAIN_EDITS=1." >&2
    exit 2
    ;;
esac

exit 0

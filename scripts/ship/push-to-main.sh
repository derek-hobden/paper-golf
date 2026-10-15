#!/usr/bin/env bash
# Push the current branch to main on origin (GitHub derek-hobden/paper-golf;
# any origin works the same). On a GitHub origin CI and the Vercel
# preview deploy follow by themselves (.github/workflows/ci.yml); production
# never follows from a push.
#
#   bash scripts/ship/push-to-main.sh             # check, merge origin/main, push
#   bash scripts/ship/push-to-main.sh --dry-run   # everything but the push
#
# Runs from any checkout of the repo:
#   1. stops on uncommitted changes to tracked files (untracked files are fine);
#   2. npm run check (stops when red);
#   3. git fetch origin; when origin/main has commits HEAD lacks, merges it into
#      the current branch (git merge --no-edit origin/main: a merge commit, no
#      rebase) and runs npm run check again. A merge conflict stops it (aborted,
#      nothing pushed): merge origin/main by hand, resolve, commit, run again;
#   4. pushes HEAD:refs/heads/main, fast-forward only: no force, no other refs.
#      When main moved in the meantime the push is rejected: fetch, merge,
#      check and push again, at most 3 tries. An origin without main (empty)
#      gets its first main.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

dry_run=false
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) ship_die "unknown argument: $1" ;;
  esac
  shift
done

ship_need git npm

top="$(git rev-parse --show-toplevel 2>/dev/null)" || ship_die "not inside a git checkout"
cd "$top"
[ -z "$(git status --porcelain --untracked-files=no)" ] ||
  ship_die "uncommitted changes to tracked files: commit or discard them first"
echo "→ origin: $(git remote get-url origin 2>/dev/null || echo '<none>')"

run_check() {
  echo "→ npm run check on $(git rev-parse --short=12 HEAD)"
  npm run check || ship_die "npm run check failed on $(git rev-parse --short=12 HEAD): nothing pushed"
}

# Fetch origin and bring HEAD up to date with origin/main (merge + check when
# it moved). Sets has_main=true when origin has a main. $1=true after a
# rejected push: then main must have moved, else the rejection is something else.
sync_origin() {
  has_main=false
  echo "→ fetching origin"
  local heads
  heads="$(git ls-remote --heads origin main)" || ship_die "could not read origin"
  if [ -z "$heads" ]; then
    [ "$1" = false ] || ship_die "the push was rejected and origin still has no main"
    echo "  origin has no main: first push of main"
    return 0
  fi
  has_main=true
  git fetch --no-tags origin main || ship_die "could not fetch origin main"
  git rev-parse -q --verify refs/remotes/origin/main >/dev/null || ship_die "no origin/main after the fetch"
  if git merge-base --is-ancestor origin/main HEAD; then
    [ "$1" = false ] || ship_die "the push was rejected but origin/main did not move: see the git output above"
    return 0
  fi
  echo "→ origin/main has $(git rev-list --count HEAD..origin/main) commit(s) this branch lacks: merging"
  if ! git merge --no-edit origin/main; then
    git merge --abort 2>/dev/null || true
    ship_die "merge conflict with origin/main (merge aborted, nothing pushed): run git merge origin/main, resolve the conflicts, commit, then run this again"
  fi
  run_check
}

run_check
retry=false
for try in 1 2 3; do
  sync_origin "$retry"
  sha="$(git rev-parse HEAD)"
  if [ "$has_main" = true ]; then
    if git merge-base --is-ancestor HEAD origin/main; then
      echo "nothing to push: origin/main already has ${sha:0:12}"
      exit 0
    fi
    echo "  $(git rev-list --count "origin/main..$sha") commit(s) on top of origin/main:"
    git log --format='    %h %s' "origin/main..$sha"
  fi
  if [ "$dry_run" = true ]; then
    echo "Dry run: would run git push origin $sha:refs/heads/main (fast-forward, no force)"
    exit 0
  fi
  echo "→ pushing ${sha:0:12} to main (try $try of 3)"
  if git -c push.followTags=false push origin "$sha:refs/heads/main"; then
    echo "✓ Pushed ${sha:0:12} to main."
    echo "sha:    $sha"
    exit 0
  fi
  echo "  push rejected: main probably moved; fetching, merging and checking again"
  retry=true
done
ship_die "the push was rejected 3 times (main kept moving): nothing more pushed; run this again"

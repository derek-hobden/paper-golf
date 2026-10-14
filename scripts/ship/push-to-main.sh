#!/usr/bin/env bash
# Push the job's approved commit to main on GitHub (derek-hobden/paper-golf):
# the "pushing" stage. CI, then the Vercel preview deploy, follow by themselves
# (.github/workflows/ci.yml); production never follows from a push.
#
#   bash scripts/ship/push-to-main.sh [--job <job folder>]             # push
#   bash scripts/ship/push-to-main.sh [--job <job folder>] --dry-run   # everything but the push
#
# Run it from the job worktree, only after Derek's yes for this commit was
# recorded (bots-work lib/record-approval.sh -> <job>/approvals/main.json) and
# the local checks passed on it (lib/record-checks.sh, which runs
# scripts/ship/check.sh -> <job>/approvals/checks.json). It refuses unless:
#   - the worktree is clean and its origin is GitHub $SHIP_REPO;
#   - HEAD contains origin/main after a fetch (else: git rebase origin/main,
#     then lib/record-checks.sh <job> again). First push (Derek, 14 Oct 2026
#     21:50): when origin has no refs at all (`git ls-remote origin` prints
#     nothing), there is no origin/main to contain, so this one check is
#     skipped; everything else below still applies;
#   - approval_for_sha <job> main HEAD passes (bots-work lib/approval-lib.sh):
#     HEAD is the approved commit, or a rebase of it onto origin/main with the
#     same patch-id, and checks.json records a pass on HEAD itself.
# It pushes exactly <HEAD sha>:refs/heads/main: no tags (Paper Golf has none),
# no --force, no other refs. --job defaults to the folder holding the worktree.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

dry_run=false
job=''
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --job) job="${2:-}"; [ -n "$job" ] || ship_die "--job needs a job folder"; shift ;;
    -h | --help) sed -n '2,23p' "$0"; exit 0 ;;
    *) ship_die "unknown argument: $1" ;;
  esac
  shift
done

ship_need git jq python3

top="$(git rev-parse --show-toplevel 2>/dev/null)" || ship_die "not inside a git checkout"
[ -n "$job" ] || job="$(dirname "$top")"
job="$(cd "$job" 2>/dev/null && pwd)" || ship_die "no such job folder: $job"
[ -f "$job/meta.json" ] || ship_die "not a job folder (no meta.json): $job"
[ "$(cd "$job/worktree" 2>/dev/null && pwd -P)" = "$(cd "$top" && pwd -P)" ] ||
  ship_die "run this from the job's worktree ($job/worktree), not $top"

[ -z "$(git status --porcelain)" ] ||
  ship_die "uncommitted changes: commit them first, then lib/record-checks.sh and Derek's yes for that commit"

ship_origin_is_github ||
  ship_die "origin is $(git remote get-url origin 2>/dev/null || echo '<none>'), not GitHub $SHIP_REPO (docs/github-origin.md)"

[ -f "$SHIP_APPROVAL_LIB" ] || ship_die "approval lib not found: $SHIP_APPROVAL_LIB (refusing without the release gate)"
# shellcheck source=/dev/null
. "$SHIP_APPROVAL_LIB"
declare -F approval_for_sha >/dev/null || ship_die "$SHIP_APPROVAL_LIB has no approval_for_sha"

sha="$(git rev-parse HEAD)"
echo "→ reading origin"
remote_refs="$(git ls-remote origin)" || ship_die "could not read origin ($SHIP_REPO)"
if [ -z "$remote_refs" ]; then
  echo "  origin has no refs at all: first push of main ($(git rev-list --count "$sha") commit(s), HEAD ${sha:0:12})"
else
  echo "→ fetching origin main"
  git fetch --no-tags origin main >/dev/null 2>&1 || ship_die "could not fetch origin main"
  git rev-parse -q --verify refs/remotes/origin/main >/dev/null || ship_die "no origin/main after the fetch"

  git merge-base --is-ancestor origin/main "$sha" ||
    ship_die "${sha:0:12} is not on top of origin/main: git rebase origin/main, then lib/record-checks.sh $(basename "$job")"
  count="$(git rev-list --count "origin/main..$sha")"
  if [ "$count" = 0 ]; then
    echo "nothing to push: origin/main already has ${sha:0:12}"
    exit 0
  fi
  echo "  $count commit(s) on top of origin/main:"
  git log --format='    %h %s' "origin/main..$sha"
fi

echo "→ release gate: approval_for_sha $(basename "$job") main ${sha:0:12}"
APPROVAL_WHY=''
approval_for_sha "$job" main "$sha" || ship_die "refused: $APPROVAL_WHY"
echo "  approved and checked: $(jq -r '"\(.commit[0:12]) by \(.approved_by) (\(.bot)) at \(.time)"' "$job/approvals/main.json")"

if [ "$dry_run" = true ]; then
  echo "Dry run: would run git push origin $sha:refs/heads/main (no tags, no force)"
  exit 0
fi

echo "→ pushing ${sha:0:12} to main"
git -c push.followTags=false push origin "$sha:refs/heads/main" ||
  ship_die "the push was refused. If main moved, fetch, rebase, re-run the checks and run this again."

echo "✓ Pushed ${sha:0:12} to main. Next, by themselves: CI, then the Vercel preview deploy."
echo "sha:    $sha"
echo "next:   bash scripts/ship/wait-for-next-stage.sh ${sha:0:12} --from pushed"

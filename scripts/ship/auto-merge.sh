#!/usr/bin/env bash
# Turn GitHub's auto-merge on for every open pull request when it opens:
# squash, and delete the head branch when the repository setting allows it.
# There is no risk gate. GitHub requires derek-hobden's Approve review (main's
# branch protection asks for one approving review), then auto-merge merges the
# pull request once the required checks are green. He does not click Merge.
#
#   PR=<number> bash scripts/ship/auto-merge.sh
#   HEAD_SHA=<sha> bash scripts/ship/auto-merge.sh
#
# PR is the pull request. With PR empty, HEAD_SHA finds it. The pull request
# is read through gh api and nothing from its head is run here. GH_TOKEN is the
# Golf Gus Bot installation token: GitHub refuses the mutation to a workflow's
# own GITHUB_TOKEN, and a Dependabot run only ever has a read-only one.
#
# Prints:
#   automerge=on|skip
#   reason=<why, in plain English>
#
# on    auto-merge is on (squash). GitHub merges once the required checks pass.
# skip  closed, merged, a draft, or a fork: nothing is turned on.
#
# Exit 0 on every decision, 1 when the pull request cannot be read or the
# mutation is refused (the refusal is quoted), 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,24p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: PR=<number> auto-merge.sh" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

pr="${PR:-}"
head_sha="${HEAD_SHA:-}"
[ -n "$pr" ] || [ -n "$head_sha" ] || { echo "PR or HEAD_SHA is required" >&2; exit 2; }

decided() {
  echo "automerge=$1"
  echo "reason=$2"
  exit 0
}

if [ -z "$pr" ]; then
  [[ "$head_sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "HEAD_SHA is not a commit sha" >&2; exit 2; }
  pr="$(gh api "/repos/$SHIP_REPO/commits/$head_sha/pulls" --jq '.[0].number // empty')" || {
    echo "cannot read the pull requests of $head_sha" >&2
    exit 1
  }
  [ -n "$pr" ] || decided skip "no pull request for ${head_sha:0:12}"
fi
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "PR must be a number" >&2; exit 2; }

# One object. A flattened line would cut the body at its first newline.
info="$(gh api "/repos/$SHIP_REPO/pulls/$pr" --jq '.')" || {
  echo "cannot read pull request $pr" >&2
  exit 1
}
state="$(jq -r '.state // ""' <<<"$info")"
merged="$(jq -r 'if .merged == true then "true" else "false" end' <<<"$info")"
draft="$(jq -r 'if .draft == true then "true" else "false" end' <<<"$info")"
head_repo="$(jq -r '.head.repo.full_name // ""' <<<"$info")"

[ "$merged" != true ] || decided skip "pull request $pr is already merged"
[ "$state" = open ] || decided skip "pull request $pr is $state, not open"
[ "$draft" != true ] || decided skip "pull request $pr is a draft"
[ -z "$head_repo" ] || [ "$head_repo" = "$SHIP_REPO" ] ||
  decided skip "pull request $pr is from $head_repo, not $SHIP_REPO"

# Auto-merge deletes the head branch only when the repository says so.
gh api --method PATCH "/repos/$SHIP_REPO" -f delete_branch_on_merge=true >/dev/null 2>&1 || true

err="$(mktemp)"
trap 'rm -f "$err"' EXIT
if gh pr merge "$pr" --repo "$SHIP_REPO" --auto --squash >/dev/null 2>"$err"; then
  decided on "squash auto-merge is on for pull request $pr: GitHub merges it and deletes the branch once derek-hobden has approved it and the required checks are green"
fi

why="$(tr '\n' ' ' <"$err" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
echo "automerge=error"
echo "reason=GitHub refused to turn auto-merge on for pull request $pr: ${why:-gh said nothing}"
case "$why" in
  *"not accessible by integration"* | *"Resource not accessible"*)
    echo "This token may not enable auto-merge. GITHUB_TOKEN is refused for the mutation, and a Dependabot pull request gets a read-only one on every path, so the workflow runs as the Golf Gus Bot app: GOLF_GUS_APP_ID and GOLF_GUS_APP_KEY have to be in this repository's Actions secrets and in its Dependabot secrets." ;;
  *draft*)
    echo "The pull request is still a draft. GitHub enables auto-merge only on one that is ready for review." ;;
  *"not allowed"* | *"auto merge"* | *"Auto-merge"*)
    echo "Auto-merge is switched off for this repository: turn it on under Settings → General → Allow auto-merge, then re-run this job." ;;
  *)
    echo "Read the refusal above: the decision here was to turn auto-merge on." ;;
esac
exit 1

#!/usr/bin/env bash
# Turn GitHub's auto-merge (squash) on for a risk:low pull request whose Claude
# review passed: the auto-merge half of the rules in CLAUDE.md "Ship process".
# The review job cannot do it itself — a pull request opened by Dependabot runs
# with a read-only GITHUB_TOKEN, so the enablePullRequestAutoMerge mutation is
# refused there (PR 13, run 39659612854) — so .github/workflows/auto-merge.yml
# runs this after the review, in the repository's own context.
#
#   PR=<number> REVIEW_CONCLUSION=<the review run's conclusion> \
#     bash scripts/ship/auto-merge.sh
#   HEAD_SHA=<sha> REVIEW_CONCLUSION=success bash scripts/ship/auto-merge.sh
#
# PR is the pull request to decide on; with PR empty, HEAD_SHA finds it. The
# pull request is read through gh api and nothing from its head is run here.
#
# Prints:
#   automerge=on|off|skip
#   reason=<why, in plain English>
#
# on   risk:low and the review passed: auto-merge is on, and GitHub merges the
#      pull request once every required check is green.
# off  anything else (risk:high, no risk label, a review that did not pass):
#      auto-merge is turned off, and Derek merges it in GitHub.
# skip the pull request is closed or already merged, or there is none: nothing
#      is written at all.
#
# Exit 0 on every decision, 1 when the pull request cannot be read or the
# mutation is refused (the refusal is quoted, with what it means), 2 on a usage
# error. Turning auto-merge on merges nothing by itself: GitHub still waits for
# check, smoke, signoff and claude-review.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,31p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: PR=<number> REVIEW_CONCLUSION=<conclusion> auto-merge.sh" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

pr="${PR:-}"
head_sha="${HEAD_SHA:-}"
conclusion="${REVIEW_CONCLUSION:-}"
[ -n "$conclusion" ] || { echo "REVIEW_CONCLUSION is required" >&2; exit 2; }
[ -n "$pr" ] || [ -n "$head_sha" ] || { echo "PR or HEAD_SHA is required" >&2; exit 2; }

decided() {
  echo "automerge=$1"
  echo "reason=$2"
  exit 0
}

# The pull request of a commit, when the workflow_run payload named none.
if [ -z "$pr" ]; then
  [[ "$head_sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "HEAD_SHA is not a commit sha" >&2; exit 2; }
  pr="$(gh api "/repos/$SHIP_REPO/commits/$head_sha/pulls" --jq '.[0].number // empty')" || {
    echo "cannot read the pull requests of $head_sha" >&2
    exit 1
  }
  [ -n "$pr" ] || decided skip "no open pull request for ${head_sha:0:12}"
fi
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "PR must be a number" >&2; exit 2; }

# One read: the state, whether it is merged, and its labels.
info="$(gh api "/repos/$SHIP_REPO/pulls/$pr" --jq '
  "state=\(.state)", "merged=\(.merged == true)", "labels=\([.labels[].name] | join(" "))"')" || {
  echo "cannot read pull request $pr" >&2
  exit 1
}
state="$(awk -F= '$1 == "state" { print $2; exit }' <<<"$info")"
merged="$(awk -F= '$1 == "merged" { print $2; exit }' <<<"$info")"
labels=" $(awk -F= '$1 == "labels" { sub(/^labels=/, ""); print; exit }' <<<"$info") "

[ "$merged" != true ] || decided skip "pull request $pr is already merged"
[ "$state" = open ] || decided skip "pull request $pr is $state, not open"

# risk:high and unlabelled pull requests wait for Derek, exactly as before; so
# does one whose review did not pass. Auto-merge is turned off either way, in
# case an earlier run of this workflow turned it on.
leave_off() {
  gh pr merge "$pr" --repo "$SHIP_REPO" --disable-auto >/dev/null 2>&1 || true
  decided off "$1"
}
case "$labels" in
  *" risk:low "*) ;;
  *" risk:high "*) leave_off "risk:high: Derek approves and merges pull request $pr in GitHub" ;;
  *) leave_off "no risk: label on pull request $pr yet: nothing to turn auto-merge on for" ;;
esac
[ "$conclusion" = success ] ||
  leave_off "the Claude review did not pass on this run ($conclusion): auto-merge stays off"

# The mutation. Its refusals read alike in the log, so say which one it was:
# the old warning blamed the repository setting for a token that may not merge.
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
if gh pr merge "$pr" --repo "$SHIP_REPO" --auto --squash >/dev/null 2>"$err"; then
  decided on "risk:low and the Claude review passed: GitHub merges pull request $pr once check, smoke, signoff and claude-review are green"
fi

why="$(tr '\n' ' ' <"$err" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
echo "automerge=error"
echo "reason=GitHub refused to turn auto-merge on for pull request $pr: ${why:-gh said nothing}"
case "$why" in
  *"not accessible by integration"* | *"Resource not accessible"*)
    echo "This job's GITHUB_TOKEN may not enable auto-merge. It needs contents: write and pull-requests: write, and it must run outside the pull request's own context (a run on a Dependabot branch gets a read-only token)." ;;
  *"not allowed"* | *"auto merge"* | *"Auto-merge"*)
    echo "Auto-merge is switched off for this repository: turn it on under Settings → General → Allow auto-merge, then re-run this job." ;;
  *)
    echo "Read the refusal above: the pull request is risk:low with a green review, so the decision here was to turn auto-merge on." ;;
esac
exit 1

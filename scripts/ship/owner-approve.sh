#!/usr/bin/env bash
# The owner's Approve review, asked for with a label.
#
# main's branch protection requires one approving review, and GitHub never
# counts an author approving their own pull request. A pull request opened under
# Derek's account — by him, or by a coding session using his credentials — could
# therefore only merge by admin override. This is the way in: an approver adds
# the `approved` label, and the Golf Gus Bot app submits the APPROVE review.
#
#   GH_TOKEN=<app token> PR=<number> ACTOR=<login> bash scripts/ship/owner-approve.sh approve
#   GH_TOKEN=<app token> PR=<number> bash scripts/ship/owner-approve.sh dismiss
#
# approve  the label was added by ACTOR. When ACTOR is on the allowlist the app
#          submits an APPROVE review naming them and the head commit. When they
#          are not, the label comes off again and a comment says why: the label
#          is only ever on a pull request the app has approved at that head.
# dismiss  new commits landed. The app dismisses its own approval (its review
#          carries a marker, so a person's Approve is never touched) and takes
#          the label off, so it has to be asked for again on the new head. That
#          holds whether or not branch protection dismisses stale reviews.
#
# The allowlist is the repository variable APPROVERS when it is set (logins
# separated by commas, spaces or newlines), otherwise `.github/pr-approvers` — read
# from the base commit by the workflow, so a pull request cannot add itself to
# it. The login check ignores case, as GitHub does. An empty allowlist approves
# nobody.
#
# Prints `approval=<outcome>` and `reason=<why, in plain English>`:
#   submitted  the app approved this head commit
#   refused    no review: not an approver, a draft, or a fork. The label is off
#   dismissed  the app's own approval is gone and the label is off
#   skip       merged or closed: nothing to do
#
# Reads the pull request through gh api. Nothing from its head is checked out or
# run. Exit 0 on every decision, 1 when the repository has no approvers at all
# or the pull request cannot be read, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,38p' "$0"; exit 0 ;; esac
mode="${1:-}"
case "$mode" in approve | dismiss) ;; *) echo "usage: owner-approve.sh approve|dismiss (see --help)" >&2; exit 2 ;; esac
[ $# -eq 1 ] || { echo "usage: owner-approve.sh approve|dismiss (see --help)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

[ -n "${PR:-}" ] || { echo "PR is not set" >&2; exit 2; }
case "$PR" in '' | *[!0-9]*) echo "PR must be a pull request number" >&2; exit 2 ;; esac

LABEL="$SHIP_APPROVED_LABEL"
MARKER="$SHIP_APPROVED_MARKER"
# The allowlist file, relative to the checkout this script was run from.
APPROVERS_FILE="${APPROVERS_FILE:-$here/../../.github/pr-approvers}"

decided() {
  echo "approval=$1"
  echo "reason=$2"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '### Owner approval\n\n%s\n' "$2" >>"$GITHUB_STEP_SUMMARY"
  fi
  exit "${3:-0}"
}

lower() { tr '[:upper:]' '[:lower:]'; }

# One login per line, lowercased. The variable wins; the file is the fallback.
# `#` starts a comment in the file, and blank entries are dropped.
allowlist() {
  local raw=''
  if [ -n "$(printf '%s' "${APPROVERS:-}" | tr -d '[:space:]')" ]; then
    raw="$APPROVERS"
  elif [ -f "$APPROVERS_FILE" ]; then
    raw="$(sed -e 's/#.*//' "$APPROVERS_FILE")"
  fi
  printf '%s' "$raw" | tr ',;' '  ' | tr -s '[:space:]' '\n' | grep -v '^$' | lower || true
}

# The label comes off. It is already gone when nobody added it, which is fine.
remove_label() {
  gh api --method DELETE "/repos/$SHIP_REPO/issues/$PR/labels/$LABEL" >/dev/null 2>&1 ||
    echo "the $LABEL label was not on pull request $PR (or could not be removed)"
}

say_on_the_pull_request() {
  gh api --method POST "/repos/$SHIP_REPO/issues/$PR/comments" -f "body=$1" >/dev/null 2>&1 ||
    echo "::warning::could not comment on pull request $PR"
}

pr_row="$(gh api "/repos/$SHIP_REPO/pulls/$PR" \
  --jq '[.state, (.draft | tostring), ((.merged // false) | tostring), .head.sha, (.head.repo.full_name // "")] | @tsv')" || {
  echo "cannot read pull request $PR" >&2
  exit 1
}
IFS=$'\t' read -r pr_state pr_draft pr_merged pr_head pr_head_repo <<<"$pr_row"

[ "$pr_merged" != true ] || decided skip "pull request $PR is already merged"
[ "$pr_state" = open ] || decided skip "pull request $PR is $pr_state, not open"

if [ "$mode" = dismiss ]; then
  # Only the app's own approvals, found by the marker it wrote into the body.
  ids="$(gh api --paginate "/repos/$SHIP_REPO/pulls/$PR/reviews" --jq '
    .[] | select(.state == "APPROVED")
    | select((.body // "") | contains("'"$MARKER"'")) | .id')" || {
    echo "cannot read the reviews on pull request $PR" >&2
    exit 1
  }
  dropped=0
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    if gh api --method PUT "/repos/$SHIP_REPO/pulls/$PR/reviews/$id/dismissals" \
      -f "message=A new commit landed, so this approval no longer covers the head of the pull request. Add the $LABEL label again to ask for a fresh one." \
      -f event=DISMISS >/dev/null 2>&1; then
      dropped=$((dropped + 1))
    else
      # dismiss-stale-reviews may have dropped it already. Not a failure.
      echo "review $id was already dismissed (or could not be dismissed)"
    fi
  done <<<"$ids"
  remove_label
  decided dismissed "a new commit landed on pull request $PR: $dropped approval(s) by this app dismissed and the $LABEL label removed. Add it again to approve $pr_head."
fi

# approve from here down.
[ -n "${ACTOR:-}" ] || { echo "ACTOR is not set: owner-approve.sh approve needs the login that added the label" >&2; exit 2; }
actor="$(printf '%s' "$ACTOR" | lower)"

if [ "$pr_draft" = true ]; then
  remove_label
  say_on_the_pull_request "$MARKER The \`$LABEL\` label was removed: this pull request is still a draft, and a draft never merges. Mark it ready for review, then add the label again."
  decided refused "pull request $PR is a draft, so there is nothing to approve"
fi

if [ -n "$pr_head_repo" ] && [ "$pr_head_repo" != "$SHIP_REPO" ]; then
  remove_label
  say_on_the_pull_request "$MARKER The \`$LABEL\` label was removed: the head of this pull request is the fork $pr_head_repo, and this pipeline does not merge forks. Push the branch to $SHIP_REPO and open it from there."
  decided refused "the head of pull request $PR is the fork $pr_head_repo, not $SHIP_REPO"
fi

approvers="$(allowlist)"
if [ -z "$approvers" ]; then
  remove_label
  say_on_the_pull_request "$MARKER The \`$LABEL\` label was removed: this repository has no approvers configured, so nobody can approve by label. Set the APPROVERS repository variable, or list the logins in \`.github/pr-approvers\` (docs/pipeline-rollout.md)."
  decided refused "this repository has no approvers: set the APPROVERS variable or list logins in .github/pr-approvers" 1
fi

if ! grep -qxF -- "$actor" <<<"$approvers"; then
  remove_label
  say_on_the_pull_request "$MARKER The \`$LABEL\` label was added by $ACTOR, who is not on this repository's approver allowlist, so it has been removed and no review was submitted. The allowlist is the APPROVERS repository variable, or \`.github/pr-approvers\` on the base branch (AGENTS.md \"Owner approval\")."
  decided refused "$ACTOR is not on this repository's approver allowlist, so the $LABEL label was removed"
fi

body="$MARKER Approved by $ACTOR, who added the \`$LABEL\` label, for head $pr_head. Golf Gus Bot submits this review because GitHub does not count an author approving their own pull request; a new commit dismisses it and takes the label off again."
if gh api --method POST "/repos/$SHIP_REPO/pulls/$PR/reviews" \
  -f event=APPROVE -f "body=$body" >/dev/null; then
  decided submitted "$ACTOR approved pull request $PR at $pr_head, and the app submitted the APPROVE review"
fi
echo "GitHub refused the APPROVE review on pull request $PR. The app needs pull-requests: write on this" >&2
echo "repository, and GOLF_GUS_APP_ID and GOLF_GUS_APP_KEY have to be in its Actions secrets." >&2
exit 1

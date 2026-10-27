#!/usr/bin/env bash
# Does a pull request event earn the paid jobs? Those are the ones that cost
# money outside GitHub minutes: the Claude review and the explainer video.
# Free checks run on every push; paid work runs only when the pull request is
# ready for review, so opening a draft early and pushing to it all day costs
# nothing (AGENTS.md "Paid jobs").
#
#   PAID_EVENT=pull_request PAID_ACTION=ready_for_review PAID_DRAFT=false \
#   PAID_AUTHOR=someone PAID_HEAD_REPO=o/r PAID_REPO=o/r \
#     bash scripts/ship/paid-trigger.sh
#
# Prints `paid=yes` or `paid=no` and `reason=<why>`, and appends both to
# $GITHUB_OUTPUT when it is set, so a workflow job can gate on it. Exit 0 for
# either answer (the decision is the output, not the status), 2 on a usage
# error. Reads nothing, writes nothing, calls nothing.
#
# Yes for exactly three events on a pull request of this repo, by a person:
# opened as a non-draft, marked ready for review, or labelled `ready` (adding
# the label again is how you ask for another run). A manual workflow_dispatch
# is a yes too — that is the by-hand re-run. Everything else is a no: an edit,
# a reopen, a draft, a fork, and a bot.
#
# A push (synchronize) is a yes for the review only when it has to be: the
# last review asked for changes (PAID_REVIEW_STATE=changes-requested), or it
# passed and the push brought a commit that needs a review of its own
# (stale-pass) — scripts/ship/review-state.sh decides both, and a docs-only
# commit or a clean merge of main leaves it `passed`. After MAX_ROUNDS reviews
# that asked for changes (PAID_ROUND) it is a no with `person=yes`: automatic
# re-reviews stop and a person has to look; a ready mark starts the rounds over.
#
# PAID_FOR=video is the explainer's recorder, which starts on one event only:
# the review-passed label going on, which the Golf Gus Bot app does when a
# review passes. Review first, then the video (AGENTS.md "Paid jobs").
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,33p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: paid-trigger.sh (see --help)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

# The label that asks for the paid jobs again.
READY_LABEL=ready
# The label the app adds when a review passes: the recorder's only start.
REVIEW_PASSED_LABEL=review-passed
# Reviews that asked for changes before the automatic re-reviews stop.
MAX_ROUNDS="$SHIP_MAX_ROUNDS"

# answer <yes|no> <reason> [person]: person=yes asks for the needs-a-person
# note, and max_rounds=<MAX_ROUNDS> goes with it so the note names this cap.
answer() {
  local lines
  lines="$(printf 'paid=%s\nreason=%s' "$1" "$2")"
  [ -z "${3:-}" ] || lines="$(printf '%s\nperson=%s\nmax_rounds=%s' "$lines" "$3" "$MAX_ROUNDS")"
  printf '%s\n' "$lines"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s\n' "$lines" >>"$GITHUB_OUTPUT"
  fi
  exit 0
}

event="${PAID_EVENT:-}"
action="${PAID_ACTION:-}"
label="${PAID_LABEL:-}"
draft="${PAID_DRAFT:-}"
author="${PAID_AUTHOR:-}"
head_repo="${PAID_HEAD_REPO:-}"
repo="${PAID_REPO:-}"

# By hand, from the Actions tab. The only path that is not a pull request event.
if [ "$event" = workflow_dispatch ]; then
  answer yes "a person asked for this run by hand"
fi

# A fork's head is not this repo. The video job builds and runs the head, and
# the publish job holds the secrets; neither is offered to code from a fork.
if [ -n "$head_repo" ] && [ -n "$repo" ] && [ "$head_repo" != "$repo" ]; then
  answer no "the head is the fork $head_repo"
fi

case "$author" in
  'dependabot[bot]' | 'renovate[bot]')
    answer no "$author does not get the paid jobs"
    ;;
esac

# A draft is the intended way to work in progress, and it never merges, so it
# never needs a review or a video. This also catches `labeled` on a draft.
if [ "$draft" = true ]; then
  answer no "the pull request is a draft"
fi

if [ "${PAID_FOR:-review}" = video ]; then
  if [ "$action" = labeled ] && [ "$label" = "$REVIEW_PASSED_LABEL" ]; then
    answer yes "the $REVIEW_PASSED_LABEL label was added"
  fi
  answer no "the video starts only when the $REVIEW_PASSED_LABEL label is added, after a review passes"
fi

if [ "$action" = synchronize ]; then
  state="${PAID_REVIEW_STATE:-}"
  round="${PAID_ROUND:-}"
  case "$state" in
    changes-requested | stale-pass) ;;
    passed) answer no "the head is still covered by the review that passed" ;;
    *) answer no "a push is free until a review has asked for changes or passed" ;;
  esac
  case "$round" in '' | *[!0-9]*) answer no "the review round is unknown ($round), so no review is bought on a guess" ;; esac
  if [ "$round" -ge "$MAX_ROUNDS" ]; then
    answer no "the review asked for changes $round times since the last ready mark; automatic re-reviews stop here and a person has to look" yes
  fi
  if [ "$state" = changes-requested ]; then
    answer yes "a push after the last review asked for changes (round $round)"
  fi
  answer yes "a push after a pass that brought a commit that needs a review of its own"
fi

case "$action" in
  opened) answer yes "opened as a non-draft" ;;
  ready_for_review) answer yes "marked ready for review" ;;
  labeled)
    if [ "$label" = "$READY_LABEL" ]; then
      answer yes "the $READY_LABEL label was added"
    fi
    answer no "the label $label is not $READY_LABEL"
    ;;
  '') answer no "no action" ;;
  *) answer no "$action is not a ready mark" ;;
esac

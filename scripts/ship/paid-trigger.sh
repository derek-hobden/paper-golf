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
# is a yes too — that is the by-hand re-run. Everything else is a no: a push
# (synchronize), an edit, a reopen, a draft, a fork, and a bot.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,20p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: paid-trigger.sh (see --help)" >&2; exit 2; }

# The label that asks for the paid jobs again.
READY_LABEL=ready

answer() {
  printf 'paid=%s\nreason=%s\n' "$1" "$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'paid=%s\nreason=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"
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

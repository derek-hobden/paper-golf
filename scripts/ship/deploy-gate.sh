#!/usr/bin/env bash
# Whether this Deploy run may deploy, and which commit (CLAUDE.md "Ship process"
# step 4). .github/workflows/deploy.yml runs on workflow_run of CI, and such a
# run carries main's tip rather than the commit the triggering CI run tested, so
# the whole decision is made here from that run's own fields.
#
#   CI_STATUS=completed CI_CONCLUSION=success CI_EVENT=push CI_BRANCH=main \
#     CI_HEAD_REPO=derek-hobden/paper-golf CI_SHA=<40-hex> \
#     REQUEST_FILE=deploy-request/deploy-request.json \
#     bash scripts/ship/deploy-gate.sh
#
# Prints:
#   deploy=true|false
#   sha=<the commit to deploy>  mode=push|reconcile|dispatch   (when deploy=true)
#   reason=<why, in plain English>
#
# true only when every one of these holds:
#   - the CI run is completed and its conclusion is success
#   - it ran on main, in this repository
#   - its event is a push or a workflow_dispatch on main
#   - its deploy-request.json names a full sha and that same event
#   - on a push, or on ci.yml's normal dispatch, the request names the run's own
#     head_sha and that sha is still what main points at
#   - on the emergency production dispatch, the request confirms it with
#     confirm=deploy-production
#
# What a dispatch means is in its request. ci.yml's normal path carries no
# confirm at all and runs main HEAD, standing in for the push run GitHub does
# not start for a merge made with its own GITHUB_TOKEN (main d75953a, PR 22):
# that is the same commit on main arriving the same way, so it is gated exactly
# like a push and deploys the same way (mode=reconcile). The emergency path
# carries confirm=deploy-production (mode=dispatch).
#
# The commit deployed is the run's head_sha on a push or the normal dispatch. On
# the emergency dispatch it is the request's sha: a workflow_dispatch run's
# head_sha is the tip of the ref it ran on (main), not the `sha=` input Derek
# confirmed, which reaches us only through the request, and which ci.yml's
# resolve job has already proved is a commit on main.
#
# A push run whose commit main has moved past deploys nothing: the newer run
# deploys the newer commit (Derek, 22 Oct 2026). On 22 Oct run 39744635505
# promoted 48d5d48 to production while main was three commits further on at
# fdb6b12, whose own CI run was still going. The emergency dispatch names a sha
# Derek confirmed, so main's tip does not gate it.
#
# Cancelled, skipped, failed and unfinished CI never deploys, and any doubt —
# a field missing, the request unreadable, the tip lookup failing — is
# deploy=false: promoting an unproven commit is the one thing here that cannot
# be undone, while a deploy not taken is one merge away from taken.
# Read-only (one GET of main's tip). Exit 0 on every decision, 2 on a usage error.
set -euo pipefail
# The header, however long it grows: print from line 2 and stop at the first
# line that is not a comment, rather than at a line number that goes stale.
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: CI_SHA=<sha> CI_CONCLUSION=<conclusion> deploy-gate.sh" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

# An unset field reads as empty and fails its check below: a missing status is
# a run that has not been shown to have finished, not a finished one.
run_status="${CI_STATUS:-}"
conclusion="${CI_CONCLUSION:-}"
event="${CI_EVENT:-}"
branch="${CI_BRANCH:-}"
head_repo="${CI_HEAD_REPO:-}"
ci_sha="${CI_SHA:-}"
request="${REQUEST_FILE:-deploy-request/deploy-request.json}"
# CI_SHA alone is a usage error: with no commit there is nothing to decide about,
# so there is no deploy=false to report. Every other field missing is a decision.
[ -n "$ci_sha" ] || { echo "CI_SHA is required" >&2; exit 2; }

# The commit to deploy: the run's own, until the dispatch branch names the
# confirmed one from its request.
sha="$ci_sha"

# The triggering run, as the log should name it.
ci_run="CI run"
if [ -n "${CI_RUN_ID:-}" ]; then ci_run="CI run $CI_RUN_ID"; fi

# decided <true|false> <reason> [mode]
decided() {
  echo "deploy=$1"
  echo "reason=$2"
  if [ "$1" = true ]; then
    echo "sha=$sha"
    echo "mode=$3"
  fi
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "deploy=$1" >>"$GITHUB_OUTPUT"
    if [ "$1" = true ]; then
      echo "sha=$sha" >>"$GITHUB_OUTPUT"
      echo "mode=$3" >>"$GITHUB_OUTPUT"
    fi
  fi
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    if [ "$1" = true ]; then
      echo "Deploying ${sha:0:12}: $2" >>"$GITHUB_STEP_SUMMARY"
    else
      echo "Not deploying: $2" >>"$GITHUB_STEP_SUMMARY"
    fi
  fi
  exit 0
}

# The CI run itself: green, finished, on main, ours, and from a trigger that ships.
[[ "$ci_sha" =~ ^[0-9a-f]{40}$ ]] ||
  decided false "the $ci_run's head sha is not a full 40-hex commit (${ci_sha:-empty})"
[ "$run_status" = completed ] ||
  decided false "the $ci_run has not finished (status ${run_status:-empty})"
[ "$conclusion" = success ] ||
  decided false "the $ci_run finished ${conclusion:-empty}, not success: only a green CI run deploys"
[ "$branch" = main ] ||
  decided false "the $ci_run ran on ${branch:-no branch}, not main"
[ -n "$head_repo" ] ||
  decided false "the $ci_run names no head repository"
[ "$head_repo" = "$SHIP_REPO" ] ||
  decided false "the $ci_run came from $head_repo, not $SHIP_REPO"
case "$event" in
  push | workflow_dispatch) ;;
  *) decided false "the $ci_run's event is ${event:-empty}, not a push to main or a dispatch on main" ;;
esac

# The deploy request that run uploaded names the commit to deploy. It is the
# run's own artifact (deploy.yml downloads it by that run's id), so the event
# must match; what the sha must be depends on the event, below.
[ -f "$request" ] ||
  decided false "there is no deploy request from the $ci_run ($request is missing)"
req_sha="$(jq -r '.sha // empty' "$request")" ||
  decided false "the deploy request from the $ci_run cannot be read ($request)"
req_event="$(jq -r '.event // empty' "$request")" ||
  decided false "the deploy request from the $ci_run cannot be read ($request)"
req_confirm="$(jq -r '.confirm // empty' "$request")" ||
  decided false "the deploy request from the $ci_run cannot be read ($request)"
[[ "$req_sha" =~ ^[0-9a-f]{40}$ ]] ||
  decided false "the deploy request from the $ci_run names no full 40-hex commit (${req_sha:-empty})"
[ "$req_event" = "$event" ] ||
  decided false "the deploy request's event is ${req_event:-empty}, but the $ci_run's is $event"

# A push is never confirmed: only the emergency dispatch carries a confirm.
[ "$event" != push ] || [ -z "$req_confirm" ] ||
  decided false "the deploy request from the $ci_run is a push carrying confirm=$req_confirm: only the production dispatch is confirmed"

# Which dispatch this is, and so which rules it answers to.
mode=push
if [ "$event" = workflow_dispatch ]; then
  if [ -n "$req_confirm" ]; then
    # The emergency production path. Its run's head_sha is main's tip, not the
    # sha Derek confirmed, so the request's sha is the one to deploy and the two
    # are never compared: a confirmed commit behind main is the case this path
    # exists for. ci.yml's resolve job has already proved that sha is a commit
    # on main, and main's tip does not gate it.
    [ "$req_confirm" = deploy-production ] ||
      decided false "the production dispatch is not confirmed (confirm is $req_confirm, not deploy-production)"
    sha="$req_sha"
    decided true "the confirmed production dispatch of ${sha:0:12}, green on check and smoke" dispatch
  fi
  # No confirm: ci.yml's normal dispatch of main HEAD, which stands in for a
  # push run GitHub never started. Everything below gates it as that push.
  mode=reconcile
fi

# A push run, and the dispatch that stands in for one, tested their own commit,
# so the request must name that commit and no other. Deploying any other commit
# is the gap this script closes.
[ "$req_sha" = "$ci_sha" ] ||
  decided false "the deploy request names ${req_sha:0:12}, but the $ci_run ran on ${ci_sha:0:12}: deploy exactly the commit CI proved"

# A main commit deploys only while it is still main's tip. Main moving on is
# not an error: the CI run of the newer commit deploys that commit instead (and
# the reconciler dispatches one for a newer commit that has none).
tip="$(gh api "/repos/$SHIP_REPO/commits/$branch" --jq '.sha // empty')" ||
  decided false "cannot read what main points at now, so nothing proves ${sha:0:12} is still its tip"
[[ "$tip" =~ ^[0-9a-f]{40}$ ]] ||
  decided false "what main points at now did not read as a commit (${tip:-empty}), so nothing proves ${sha:0:12} is still its tip"
[ "$tip" = "$sha" ] ||
  decided false "main has moved on to ${tip:0:12}: ${sha:0:12} is stale and the CI run of ${tip:0:12} deploys it"
decided true "the $ci_run is green on main and ${sha:0:12} is still its tip" "$mode"

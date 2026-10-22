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
#   sha=<the commit to deploy>  mode=push|dispatch   (when deploy=true)
#   reason=<why, in plain English>
#
# true only when every one of these holds:
#   - the CI run is completed and its conclusion is success
#   - it ran on main, in this repository
#   - its event is a push or the production workflow_dispatch
#   - its deploy-request.json names that same sha and event (and, for the
#     dispatch, confirm=deploy-production)
#   - on a push, that sha is still what main points at
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
case "${1:-}" in -h | --help) sed -n '2,35p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: CI_SHA=<sha> CI_CONCLUSION=<conclusion> deploy-gate.sh" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

run_status="${CI_STATUS:-completed}"
conclusion="${CI_CONCLUSION:-}"
event="${CI_EVENT:-}"
branch="${CI_BRANCH:-}"
head_repo="${CI_HEAD_REPO:-}"
sha="${CI_SHA:-}"
request="${REQUEST_FILE:-deploy-request/deploy-request.json}"
[ -n "$sha" ] || { echo "CI_SHA is required" >&2; exit 2; }
[ -n "$conclusion" ] || { echo "CI_CONCLUSION is required" >&2; exit 2; }

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
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] ||
  decided false "the $ci_run's head sha is not a full 40-hex commit (${sha:-empty})"
[ "$run_status" = completed ] ||
  decided false "the $ci_run has not finished (status $run_status)"
[ "$conclusion" = success ] ||
  decided false "the $ci_run finished $conclusion, not success: only a green CI run deploys"
[ "$branch" = main ] ||
  decided false "the $ci_run ran on ${branch:-no branch}, not main"
[ -n "$head_repo" ] ||
  decided false "the $ci_run names no head repository"
[ "$head_repo" = "$SHIP_REPO" ] ||
  decided false "the $ci_run came from $head_repo, not $SHIP_REPO"
case "$event" in
  push | workflow_dispatch) ;;
  *) decided false "the $ci_run's event is ${event:-empty}, not a push to main or the production dispatch" ;;
esac

# The deploy request that run uploaded says which commit it proved. Deploying
# anything else is the gap this script closes, so the two must agree.
[ -f "$request" ] ||
  decided false "there is no deploy request from the $ci_run ($request is missing)"
req_sha="$(jq -r '.sha // empty' "$request")" ||
  decided false "the deploy request from the $ci_run cannot be read ($request)"
req_event="$(jq -r '.event // empty' "$request")" ||
  decided false "the deploy request from the $ci_run cannot be read ($request)"
req_confirm="$(jq -r '.confirm // empty' "$request")" ||
  decided false "the deploy request from the $ci_run cannot be read ($request)"
[ -n "$req_sha" ] ||
  decided false "the deploy request from the $ci_run names no sha"
[ "$req_sha" = "$sha" ] ||
  decided false "the deploy request names ${req_sha:0:12}, but the $ci_run ran on ${sha:0:12}: deploy exactly the commit CI proved"
[ "$req_event" = "$event" ] ||
  decided false "the deploy request's event is ${req_event:-empty}, but the $ci_run's is $event"

# The emergency production path: Derek confirmed this exact sha, so it deploys
# whether or not main has moved since. ci.yml has already proved it is on main.
if [ "$event" = workflow_dispatch ]; then
  [ "$req_confirm" = deploy-production ] ||
    decided false "the production dispatch is not confirmed (confirm is ${req_confirm:-empty}, not deploy-production)"
  decided true "the confirmed production dispatch of ${sha:0:12}, green on check and smoke" dispatch
fi

# A push deploys only while its commit is still main's tip. Main moving on is
# not an error: the CI run of the newer commit deploys that commit instead.
tip="$(gh api "/repos/$SHIP_REPO/commits/$branch" --jq '.sha // empty')" ||
  decided false "cannot read what main points at now, so nothing proves ${sha:0:12} is still its tip"
[[ "$tip" =~ ^[0-9a-f]{40}$ ]] ||
  decided false "what main points at now did not read as a commit (${tip:-empty}), so nothing proves ${sha:0:12} is still its tip"
[ "$tip" = "$sha" ] ||
  decided false "main has moved on to ${tip:0:12}: ${sha:0:12} is stale and the CI run of ${tip:0:12} deploys it"
decided true "the $ci_run is green on main and ${sha:0:12} is still its tip" push

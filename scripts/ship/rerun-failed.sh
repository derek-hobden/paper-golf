#!/usr/bin/env bash
# Turn the original red run green, rather than leave it in the head's rollup
# beside a new green one. The Ready gate and the pr-video check fire on the
# ready mark with the review and the recording they wait for; when those
# finish, this re-runs the failed jobs of the gate's or the check's own runs
# for the pull request's current head (AGENTS.md "The ready signal", "Paid
# jobs").
#
#   GH_TOKEN=<GITHUB_TOKEN with actions: write> PR=<number> \
#   WORKFLOW=ready-gate.yml|pr-video.yml EVENT=pull_request_target|pull_request \
#   [FALLBACK_INPUT=pr] bash scripts/ship/rerun-failed.sh
#
# It reads the head from the pull request, lists the newest 10 runs of WORKFLOW
# for that head and event, and calls POST actions/runs/<id>/rerun-failed-jobs
# on each whose latest attempt concluded failure or cancelled (a waiting run
# can be cancelled by a later event of the same pull request). A run for
# another commit or another pull request is never touched, and no check run is
# posted. With FALLBACK_INPUT set, when there was nothing to re-run and no run
# for the head is green or still going, WORKFLOW is dispatched on main with
# inputs[FALLBACK_INPUT]=PR instead, so the gate still records a verdict.
#
# A helper, so in doubt it warns and skips: a refused lookup, re-run or
# dispatch is a ::warning:: naming it, and the exit is 0. The token is the
# workflow's own GITHUB_TOKEN with actions: write on that job; the Golf Gus app
# has no Actions permission. Exit 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,25p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: rerun-failed.sh (see --help)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

[[ "${PR:-}" =~ ^[0-9]+$ ]] || { echo "PR must be a pull request number" >&2; exit 2; }
case "${WORKFLOW:-}" in
  ready-gate.yml | pr-video.yml) ;;
  *) echo "WORKFLOW must be ready-gate.yml or pr-video.yml" >&2; exit 2 ;;
esac
case "${EVENT:-}" in
  pull_request | pull_request_target) ;;
  *) echo "EVENT must be pull_request or pull_request_target" >&2; exit 2 ;;
esac
fallback="${FALLBACK_INPUT:-}"
[[ "$fallback" =~ ^[a-z_]*$ ]] || { echo "FALLBACK_INPUT must be an input name" >&2; exit 2; }

warn() { echo "::warning::$*"; }

head="$(gh api "/repos/$SHIP_REPO/pulls/$PR" --jq '.head.sha')" || {
  warn "could not read pull request $PR, so no $WORKFLOW run was re-run; re-run it from the Actions tab"
  exit 0
}
[[ "$head" =~ ^[0-9A-Za-z]+$ ]] || { warn "pull request $PR has no head sha; nothing re-run"; exit 0; }

# id, status, conclusion: this head and this pull request only (a run with no
# pull request listed, as a pull_request_target run can be, is taken on its sha).
runs="$(gh api "/repos/$SHIP_REPO/actions/workflows/$WORKFLOW/runs?head_sha=$head&event=$EVENT&per_page=10" --jq '
  .workflow_runs[:10][]
  | select(.head_sha == "'"$head"'")
  | select((.pull_requests // []) | length == 0 or any(.number == '"$PR"'))
  | [(.id | tostring), .status, (.conclusion // "")] | @tsv')" || {
  warn "could not list the $WORKFLOW runs for $head, so none was re-run; re-run it from the Actions tab"
  exit 0
}

rerun=0
standing=0
while IFS=$'\t' read -r id status conclusion; do
  [ -n "$id" ] || continue
  if [ "$status" != completed ] || [ "$conclusion" = success ]; then
    standing=1
    continue
  fi
  case "$conclusion" in failure | cancelled) ;; *) continue ;; esac
  if gh api --method POST "/repos/$SHIP_REPO/actions/runs/$id/rerun-failed-jobs" >/dev/null </dev/null; then
    echo "rerun: $WORKFLOW run $id ($conclusion) on $head"
    rerun=$((rerun + 1))
  else
    warn "could not re-run $WORKFLOW run $id ($conclusion) on $head; re-run it from the Actions tab"
  fi
done <<<"$runs"

if [ "$rerun" = 0 ] && [ "$standing" = 0 ] && [ -n "$fallback" ]; then
  if gh api --method POST "/repos/$SHIP_REPO/actions/workflows/$WORKFLOW/dispatches" \
    -f ref=main -f "inputs[$fallback]=$PR" >/dev/null </dev/null; then
    echo "rerun: no $WORKFLOW run on $head to re-run; dispatched it for pull request $PR"
  else
    warn "could not dispatch $WORKFLOW for pull request $PR; re-run it from the Actions tab"
  fi
elif [ "$rerun" = 0 ]; then
  echo "rerun: no failed or cancelled $WORKFLOW run on $head"
fi
exit 0

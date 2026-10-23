#!/usr/bin/env bash
# The CI run a Deploy workflow_dispatch names, in the fields deploy-gate.sh reads.
#
# scripts/ship/start-deploy.sh dispatches Deploy from inside that CI run, before
# GitHub marks the run completed, so this waits until status is completed or
# READ_CI_WAIT_S (default 90) runs out. READ_CI_INTERVAL_S (default 2) is the
# gap between reads. A zero wait returns the first read.
#
#   CI_RUN_ID=123 bash scripts/ship/read-ci-run.sh
#
# Prints status, conclusion, event, branch, head_repo and sha, and writes the
# same keys to GITHUB_OUTPUT when it is set. Exit 0 with whatever the run showed
# when the wait ended (the gate decides from that), 1 when the run cannot be
# read, 2 on a usage error.
set -euo pipefail
case "${1:-}" in
  -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;;
  '') ;;
  *) echo "usage: CI_RUN_ID=<id> read-ci-run.sh" >&2; exit 2 ;;
esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

id="${CI_RUN_ID:-}"
[[ "$id" =~ ^[0-9]+$ ]] || {
  echo "CI_RUN_ID must be the CI run's numeric id" >&2
  exit 2
}
wait_s="${READ_CI_WAIT_S:-90}"
interval="${READ_CI_INTERVAL_S:-2}"
[[ "$wait_s" =~ ^[0-9]+$ ]] || {
  echo "READ_CI_WAIT_S must be a number of seconds" >&2
  exit 2
}
[[ "$interval" =~ ^[0-9]+$ ]] || {
  echo "READ_CI_INTERVAL_S must be a number of seconds" >&2
  exit 2
}

say() {
  echo "$1=$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1=$2" >>"$GITHUB_OUTPUT"; fi
}

# One GET. Prints six lines: status, conclusion, event, branch, sha, repo.
read_run() {
  gh api "/repos/$SHIP_REPO/actions/runs/$id" --jq \
    '[.status // "", .conclusion // "", .event // "", .head_branch // "", .head_sha // "", (.head_repository.full_name // "")] | join("\n")'
}

elapsed=0
status=''
conclusion=''
event=''
branch=''
sha=''
head_repo=''
while :; do
  row="$(read_run)" || {
    echo "cannot read CI run $id" >&2
    exit 1
  }
  status="$(printf '%s\n' "$row" | sed -n 1p)"
  conclusion="$(printf '%s\n' "$row" | sed -n 2p)"
  event="$(printf '%s\n' "$row" | sed -n 3p)"
  branch="$(printf '%s\n' "$row" | sed -n 4p)"
  sha="$(printf '%s\n' "$row" | sed -n 5p)"
  head_repo="$(printf '%s\n' "$row" | sed -n 6p)"
  [ "$status" = completed ] && break
  # A zero wait (the tests) still ends: the first read is the answer.
  [ "$elapsed" -ge "$wait_s" ] && break
  sleep "$interval"
  step="$interval"
  [ "$step" -gt 0 ] || step=1
  elapsed=$((elapsed + step))
done

say status "$status"
say conclusion "$conclusion"
say event "$event"
say branch "$branch"
say head_repo "$head_repo"
say sha "$sha"

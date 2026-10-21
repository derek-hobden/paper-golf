#!/usr/bin/env bash
# Only the newest waiting deploy runs. Prints proceed=false when a newer run
# of deploy.yml is still queued or waiting; otherwise proceed=true.
# On any API doubt, proceed=true: a skipped deploy is not the fail-safe.
#
#   GITHUB_RUN_ID=123 bash scripts/ship/deploy-batch.sh
# Always exits 0.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,7p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

proceed=true
run_id="${GITHUB_RUN_ID:-0}"
# A failed lookup must not fail the step: on doubt, deploy.
set +e
if [[ "$run_id" =~ ^[0-9]+$ ]] && [ "$run_id" -gt 0 ]; then
  if runs="$(gh api "/repos/$SHIP_REPO/actions/workflows/deploy.yml/runs?per_page=50" --jq '.workflow_runs')"; then
    if jq -e 'type == "array"' <<<"$runs" >/dev/null 2>&1; then
      if newer="$(jq --argjson id "$run_id" '[.[] | select(.id > $id and (.status == "queued" or .status == "waiting" or .status == "pending" or .status == "requested" or .status == "in_progress"))] | length' <<<"$runs")"; then
        if [ "$newer" -gt 0 ]; then proceed=false; fi
      fi
    fi
  fi
fi
set -e

echo "proceed=$proceed"
if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "proceed=$proceed" >>"$GITHUB_OUTPUT"; fi
exit 0

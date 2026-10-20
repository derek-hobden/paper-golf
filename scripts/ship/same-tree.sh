#!/usr/bin/env bash
# On a push to main, decide whether check and smoke already passed for this
# commit's tree. Prints skip_tests=true only when all of these hold:
#   - the push commit's tree equals the head tree of a PR associated with it
#   - that PR has a successful pull_request CI run of ci.yml
#   - that run's check and smoke jobs succeeded
#   - the tree that run tested is this same tree
# Any doubt prints skip_tests=false. Always exits 0.
#
#   bash scripts/ship/same-tree.sh <sha>
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,10p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

skip=false
pull=
tree=

jobs_pass() {
  local jobs="$1" check smoke
  check="$(jq '[.[] | select(.name == "check" and .conclusion == "success")] | length' <<<"$jobs")"
  smoke="$(jq '[.[] | select(.name == "smoke" and .conclusion == "success")] | length' <<<"$jobs")"
  [ "$check" -ge 1 ] && [ "$smoke" -ge 1 ]
}

# Return 0 when this PR's head tree and a green check+smoke run prove the tree.
prove_pr() {
  local pr="$1" head="$2" head_tree runs run_count j run_id run_head run_tree jobs
  head_tree="$(gh api "/repos/$SHIP_REPO/commits/$head" --jq '.commit.tree.sha')" || return 1
  [ "$head_tree" = "$tree" ] || return 1
  runs="$(gh api "/repos/$SHIP_REPO/actions/workflows/ci.yml/runs?event=pull_request&head_sha=$head&status=success&per_page=20" \
    --jq "[.workflow_runs[] | select(.head_sha == \"$head\" and .conclusion == \"success\")]")" || return 1
  run_count="$(jq 'length' <<<"$runs")" || return 1
  if [ "$run_count" -eq 0 ]; then
    runs="$(gh api "/repos/$SHIP_REPO/actions/workflows/ci.yml/runs?event=pull_request&status=success&per_page=30" \
      --jq "[.workflow_runs[] | select(any(.pull_requests[]?; .number == $pr) and .conclusion == \"success\")]")" || return 1
    run_count="$(jq 'length' <<<"$runs")" || return 1
  fi
  j=0
  while [ "$j" -lt "$run_count" ]; do
    run_id="$(jq -r ".[$j].id" <<<"$runs")"
    run_head="$(jq -r ".[$j].head_sha" <<<"$runs")"
    if [ "$run_head" != "$head" ]; then
      run_tree="$(gh api "/repos/$SHIP_REPO/commits/$run_head" --jq '.commit.tree.sha')" || { j=$((j + 1)); continue; }
      if [ "$run_tree" != "$tree" ]; then
        j=$((j + 1))
        continue
      fi
    fi
    jobs="$(gh api "/repos/$SHIP_REPO/actions/runs/$run_id/jobs" --jq '.jobs')" || { j=$((j + 1)); continue; }
    if jobs_pass "$jobs"; then
      pull="$pr"
      return 0
    fi
    j=$((j + 1))
  done
  return 1
}

prove() {
  local sha="$1" pulls count i pr head
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || return 1
  tree="$(git rev-parse "${sha}^{tree}")" || return 1
  pulls="$(gh api "/repos/$SHIP_REPO/commits/$sha/pulls" --jq '.')" || return 1
  jq -e 'type == "array"' <<<"$pulls" >/dev/null || return 1
  count="$(jq 'length' <<<"$pulls")"
  [ "$count" -ge 1 ] || return 1
  i=0
  while [ "$i" -lt "$count" ]; do
    pr="$(jq -r ".[$i].number" <<<"$pulls")"
    head="$(jq -r ".[$i].head.sha" <<<"$pulls")"
    [[ "$pr" =~ ^[0-9]+$ ]] || { i=$((i + 1)); continue; }
    [[ "$head" =~ ^[0-9a-f]{40}$ ]] || { i=$((i + 1)); continue; }
    if prove_pr "$pr" "$head"; then return 0; fi
    i=$((i + 1))
  done
  return 1
}

if [ $# -eq 1 ] && prove "$1"; then
  skip=true
fi

echo "skip_tests=$skip"
if [ -n "$pull" ]; then echo "pull=$pull"; fi
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "skip_tests=$skip" >>"$GITHUB_OUTPUT"
  if [ -n "$pull" ]; then echo "pull=$pull" >>"$GITHUB_OUTPUT"; fi
fi
if [ "$skip" = true ] && [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "Skipping check and smoke: this tree already passed on PR #$pull." >>"$GITHUB_STEP_SUMMARY"
fi
exit 0

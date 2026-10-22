#!/usr/bin/env bash
# Every commit on main gets a ci.yml run. GitHub starts no push workflow for a
# push its own GITHUB_TOKEN made, so a pull request merged by GitHub's native
# auto-merge (.github/workflows/auto-merge.yml turns it on) leaves main with no
# CI run at all — and with no CI run nothing deploys: main d75953a (PR 22,
# merged 22 Oct 2026, 1:47pm Dubai) never reached staging or production. A
# workflow_dispatch made with GITHUB_TOKEN does start a run, so this reconciler
# dispatches ci.yml on main whenever main HEAD has no run of its own.
#
#   bash scripts/ship/reconcile-ci.sh            # dispatch when main HEAD has no CI run
#   bash scripts/ship/reconcile-ci.sh --dry-run  # decide and print, never dispatch
#
# Prints:
#   sha=<main HEAD>
#   runs=<ci.yml runs of that sha from a push or a dispatch>
#   dispatch=yes|no|dry-run
#   reason=<why, in plain English>
#
# Only a push run or a workflow_dispatch run of ci.yml on main counts. A
# pull_request run proves nothing about main: it tested the branch, and it
# uploads no deploy request. One dispatch per sha — the run it starts is queued
# straight away and counts from then on, so the next tick finds it and does
# nothing (the workflow serialises its runs for the same reason).
#
# Exit 0 on every decision, 1 when GitHub cannot be read or the dispatch is
# refused (nothing is dispatched on doubt), 2 on a usage error. Dispatching
# ci.yml deploys nothing by itself: ci.yml runs check and smoke first, and
# .github/workflows/deploy.yml deploys only a run that passed.
set -euo pipefail
dry=no
case "${1:-}" in
  -h | --help) sed -n '2,28p' "$0"; exit 0 ;;
  --dry-run) dry=yes; shift ;;
  '') ;;
  *) echo "usage: reconcile-ci.sh [--dry-run]" >&2; exit 2 ;;
esac
[ $# -eq 0 ] || { echo "usage: reconcile-ci.sh [--dry-run]" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

say() {
  echo "$1=$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1=$2" >>"$GITHUB_OUTPUT"; fi
}
decided() {
  say dispatch "$1"
  say reason "$2"
  exit 0
}

sha="$(gh api "/repos/$SHIP_REPO/commits/main" --jq '.sha')" || {
  echo "cannot read the head of main" >&2
  exit 1
}
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "the head of main did not read as a commit sha: ${sha:-(empty)}" >&2
  exit 1
}

# Runs of ci.yml for that exact commit, a push or a dispatch on main only.
runs="$(gh api "/repos/$SHIP_REPO/actions/workflows/ci.yml/runs?head_sha=$sha&per_page=50" --jq '
  [.workflow_runs[]? | select(.head_branch == "main" and (.event == "push" or .event == "workflow_dispatch"))]
  | length')" || {
  echo "cannot read the ci.yml runs of ${sha:0:12}" >&2
  exit 1
}
[[ "$runs" =~ ^[0-9]+$ ]] || {
  echo "the ci.yml runs of ${sha:0:12} did not read as a count: ${runs:-(empty)}" >&2
  exit 1
}

say sha "$sha"
say runs "$runs"

[ "$runs" -eq 0 ] ||
  decided no "main HEAD ${sha:0:12} already has $runs ci.yml run(s) of its own: nothing to dispatch"
[ "$dry" = no ] ||
  decided dry-run "main HEAD ${sha:0:12} has no ci.yml run: --dry-run, so nothing was dispatched"

# The dispatch. No inputs: that is ci.yml's normal path, which runs check and
# smoke on main HEAD and then deploys exactly as a push to main would.
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
if gh api --method POST "/repos/$SHIP_REPO/actions/workflows/ci.yml/dispatches" -f ref=main \
  >/dev/null 2>"$err"; then
  decided yes "main HEAD ${sha:0:12} had no ci.yml run: dispatched ci.yml on main"
fi

why="$(tr '\n' ' ' <"$err" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
say dispatch error
say reason "GitHub refused the ci.yml dispatch for ${sha:0:12}: ${why:-gh said nothing}"
case "$why" in
  *"not accessible by integration"* | *"Resource not accessible"*)
    echo "This job's GITHUB_TOKEN may not dispatch a workflow. It needs actions: write." ;;
  *)
    echo "Read the refusal above: main HEAD has no CI run, so the decision here was to dispatch ci.yml on main." ;;
esac
exit 1

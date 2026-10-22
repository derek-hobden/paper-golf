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
#   push_runs=<push runs of ci.yml on main for that sha>
#   dispatched=<dispatches of ci.yml this reconciler has already made for it>
#   dispatch=yes|no|dry-run
#   reason=<why, in plain English>
#
# Two separate questions, and both must be no before anything is dispatched:
#
#   push_runs   Does main HEAD have a CI run of its own? ONLY a push-event run
#               of ci.yml on main counts. A pull_request run tested a branch,
#               not main. The emergency production dispatch runs on main too,
#               so GitHub gives its run the tip's head_sha — but what it tested
#               and deployed is the older sha Derek confirmed, so it proves
#               nothing about the tip; counting it would leave that tip untested
#               and undeployed, which is the incident this script exists for.
#   dispatched  Have I already dispatched one? That run is a workflow_dispatch
#               run, never a push run, so it can never answer the first question
#               — but it does mean the work is already under way, and this is
#               what keeps one dispatch per sha. ci.yml's `run-name` names that
#               path "CI reconcile dispatch of main HEAD" and the emergency one
#               "CI production dispatch of <sha>", which is how the two are told
#               apart. The run is queued straight away and counts from then on,
#               so the next tick finds it and does nothing (the workflow
#               serialises its runs for the same reason).
#
# Exit 0 on every decision, 1 when GitHub cannot be read or the dispatch is
# refused (nothing is dispatched on doubt), 2 on a usage error. Dispatching
# ci.yml deploys nothing by itself: ci.yml runs check and smoke first, and
# .github/workflows/deploy.yml deploys only a run that passed.
set -euo pipefail
dry=no
case "${1:-}" in
  -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;;
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

# The name ci.yml's `run-name` gives its normal dispatch path, and nothing else.
# It must stay that name (test-ship.sh case ci_reconcile_workflow).
RECONCILE_RUN_NAME="CI reconcile dispatch of main HEAD"

# One read of this commit's ci.yml runs, counted two ways. gh api takes a jq
# expression, not jq arguments, so the name goes in as the literal it is (fixed
# ASCII; no input of any kind reaches it).
counts="$(gh api "/repos/$SHIP_REPO/actions/workflows/ci.yml/runs?head_sha=$sha&per_page=50" --jq "
  [.workflow_runs[]? | select(.head_branch == \"main\")] as \$main
  | [\$main[] | select(.event == \"push\")] | length,
    ([\$main[] | select(.event == \"workflow_dispatch\"
      and (((.name // \"\") + \" / \" + (.display_title // \"\")) | contains(\"$RECONCILE_RUN_NAME\")))]
     | length)")" || {
  echo "cannot read the ci.yml runs of ${sha:0:12}" >&2
  exit 1
}
push_runs="$(printf '%s\n' "$counts" | sed -n 1p)"
dispatched="$(printf '%s\n' "$counts" | sed -n 2p)"
# Defensive: the two lines above are counts or this script says nothing.
if ! [[ "$push_runs" =~ ^[0-9]+$ ]] || ! [[ "$dispatched" =~ ^[0-9]+$ ]]; then
  echo "the ci.yml runs of ${sha:0:12} did not read as counts: ${counts:-(empty)}" >&2
  exit 1
fi

say sha "$sha"
say push_runs "$push_runs"
say dispatched "$dispatched"

# A push run is the only kind that is main HEAD's own CI run.
[ "$push_runs" -eq 0 ] ||
  decided no "main HEAD ${sha:0:12} already has $push_runs push CI run(s) of its own: nothing to dispatch"
# And one dispatch per sha: a dispatch of mine is already running that work.
[ "$dispatched" -eq 0 ] ||
  decided no "main HEAD ${sha:0:12} has no push CI run, but this reconciler has already dispatched $dispatched: nothing to dispatch"
[ "$dry" = no ] ||
  decided dry-run "main HEAD ${sha:0:12} has no push CI run and none dispatched: --dry-run, so nothing was dispatched"

# The dispatch. No inputs: that is ci.yml's normal path, which runs check and
# smoke on main HEAD and then deploys exactly as a push to main would.
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
if gh api --method POST "/repos/$SHIP_REPO/actions/workflows/ci.yml/dispatches" -f ref=main \
  >/dev/null 2>"$err"; then
  decided yes "main HEAD ${sha:0:12} had no push CI run and none dispatched: dispatched ci.yml on main"
fi

why="$(tr '\n' ' ' <"$err" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
say dispatch error
say reason "GitHub refused the ci.yml dispatch for ${sha:0:12}: ${why:-gh said nothing}"
case "$why" in
  *"not accessible by integration"* | *"Resource not accessible"*)
    echo "This job's GITHUB_TOKEN may not dispatch a workflow. It needs actions: write." ;;
  *)
    echo "Read the refusal above: main HEAD has no push CI run and none dispatched, so the decision here was to dispatch ci.yml on main." ;;
esac
exit 1

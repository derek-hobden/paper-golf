#!/usr/bin/env bash
# Dispatch Deploy for this CI run.
#
# Deploy listens for workflow_run of CI. GitHub does not start that workflow when
# the CI run itself was started with GITHUB_TOKEN: events from that token create
# no workflow run, except workflow_dispatch and repository_dispatch
# (https://docs.github.com/en/actions/concepts/security/github_token). Reconcile
# CI dispatches this workflow with that token, so CI goes green and Deploy never
# starts (main 1d81308, run 39874595880). workflow_dispatch is the exception that
# still starts a run, so this script dispatches deploy.yml and passes this run's
# id. Deploy reads that run and hands it to the same gate a workflow_run uses.
#
# Only github-actions[bot] gets here. A push, or a dispatch a person starts,
# already starts Deploy through workflow_run; dispatching as well would deploy
# the same commit twice. The only POST is deploy.yml. Deploy does not start CI,
# so this cannot loop.
#
#   GITHUB_ACTOR=github-actions[bot] GITHUB_REF=refs/heads/main \
#     GITHUB_EVENT_NAME=workflow_dispatch GITHUB_RUN_ID=123 \
#     bash scripts/ship/start-deploy.sh
#
# Prints dispatch=yes|no and reason=. Exit 0 on a decision, 1 when GitHub
# refuses the dispatch, 2 on a usage error.
set -euo pipefail
case "${1:-}" in
  -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;;
  '') ;;
  *) echo "usage: start-deploy.sh" >&2; exit 2 ;;
esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh

say() {
  echo "$1=$2"
  if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "$1=$2" >>"$GITHUB_OUTPUT"; fi
}
# A decision not to dispatch is success: the other path already deploys.
refuse() {
  say dispatch no
  say reason "$1"
  exit 0
}

[ "${GITHUB_ACTOR:-}" = "github-actions[bot]" ] ||
  refuse "actor is ${GITHUB_ACTOR:-empty}: a person's CI run already starts Deploy through workflow_run, so this does not dispatch a second one"
[ "${GITHUB_REF:-}" = "refs/heads/main" ] ||
  refuse "ref is ${GITHUB_REF:-empty}, not main: a pull request does not deploy"
case "${GITHUB_EVENT_NAME:-}" in
  push | workflow_dispatch) ;;
  *) refuse "event is ${GITHUB_EVENT_NAME:-empty}: only a push or a dispatch on main deploys" ;;
esac

run_id="${GITHUB_RUN_ID:-}"
[[ "$run_id" =~ ^[0-9]+$ ]] || {
  echo "GITHUB_RUN_ID must be this CI run's numeric id" >&2
  exit 2
}

err="$(mktemp)"
trap 'rm -f "$err"' EXIT
if gh api --method POST "/repos/$SHIP_REPO/actions/workflows/deploy.yml/dispatches" \
  -f ref=main \
  -f "inputs[ci_run_id]=$run_id" \
  >/dev/null 2>"$err"; then
  say dispatch yes
  say reason "CI run $run_id was started by GITHUB_TOKEN, which does not trigger workflow_run: dispatched Deploy"
  exit 0
fi

why="$(tr '\n' ' ' <"$err" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//')"
say dispatch error
say reason "GitHub refused the Deploy dispatch for CI run $run_id: ${why:-gh said nothing}"
case "$why" in
  *"not accessible by integration"* | *"Resource not accessible"*)
    echo "This job's GITHUB_TOKEN may not dispatch a workflow. It needs actions: write." ;;
  *)
    echo "Read the refusal above: this CI run was started by GITHUB_TOKEN, so Deploy's workflow_run will not fire and this dispatch is what starts it." ;;
esac
exit 1

#!/usr/bin/env bash
# Where is a pushed paper-golf commit in the pipeline? Read-only: polls GitHub
# CI and the one Vercel project, never triggers a build. The same command as in
# breez, medifinder and ruckbee, for one Vercel project (preview + production).
#
#   bash scripts/ship/wait-for-next-stage.sh <sha>                  # the stage now
#   bash scripts/ship/wait-for-next-stage.sh <sha> --from <stage>   # block until it moves on
#   bash scripts/ship/wait-for-next-stage.sh --link                 # the project's Git link (want: none)
#
# Stages: pushed -> ci-running -> ci-green | ci-red -> preview-building ->
# preview-ready | preview-error, and only after a production dispatch
# (AGENTS.md "Ship process") production-building -> production-ready |
# production-error. A Vercel deployment of the sha, when there is one, sets the
# stage; production-ready only when a target=production deployment is READY.
# production-skipped: the build was only CANCELED. Deploys come from GitHub
# Actions (ci.yml, Vercel CLI); the project has no Git integration, so --link
# should print "none".
# Without VERCEL_TOKEN (read from env, never printed) Vercel is reported as
# "vercel stage unknown" and the stage comes from CI alone.
#
# With --from it polls and returns as soon as the stage differs, or after about
# nine minutes with "no change yet" (agent shells time out at ten): then run the
# printed next: command again. Post the card only when it changed.
set -euo pipefail
case "${1:-}" in -h | --help | '') sed -n '2,23p' "$0"; exit 0 ;; esac
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$dir/lib.sh"
ship_need jq curl

if [ "$1" = "--link" ]; then
  [ -n "${VERCEL_TOKEN:-}" ] || { echo "vercel link unknown (VERCEL_TOKEN not set)"; exit 0; }
  link="$(ship_vercel_link)" || ship_die "could not read the Vercel project $SHIP_VERCEL_PROJECT"
  echo "vercel link: $link"
  exit 0
fi

sha="$1"
[[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || ship_die "not a commit sha: $sha"
from=''
if [ "${2:-}" = "--from" ]; then
  from="${3:-}"
  [ -n "$from" ] || ship_die "--from needs a stage"
elif [ -n "${2:-}" ]; then
  ship_die "unknown argument: $2"
fi
ship_need gh

# Prints "ci: ...", "vercel: ..." and sets $stage.
stage=''
read_stage() {
  local ci vercel
  ci="$(ship_ci_state "$sha")" || ci=unknown
  vercel=unknown
  if [ -z "${VERCEL_TOKEN:-}" ]; then
    vercel_note="vercel stage unknown (VERCEL_TOKEN not set)"
  elif vercel="$(ship_vercel_state "$sha")"; then
    vercel_note="$vercel"
  else
    vercel=unknown
    vercel_note="vercel stage unknown (API error)"
  fi
  case "$vercel" in
    none | unknown)
      case "$ci" in none) stage=pushed ;; *) stage="$ci" ;; esac ;;
    *) stage="$vercel" ;;
  esac
  ci_note="$ci"
}

timeout_s="${WAIT_TIMEOUT_S:-540}"
interval_s="${WAIT_INTERVAL_S:-30}"
waited=0
while :; do
  read_stage
  if [ -z "$from" ] || [ "$stage" != "$from" ]; then
    echo "ci: $ci_note"
    echo "vercel: $vercel_note"
    echo "stage: $stage"
    case "$stage" in
      production-ready | production-error | production-skipped | ci-red | preview-error) ;;
      *) echo "next: bash scripts/ship/wait-for-next-stage.sh $sha --from $stage" ;;
    esac
    exit 0
  fi
  if [ "$waited" -ge "$timeout_s" ]; then
    echo "ci: $ci_note"
    echo "vercel: $vercel_note"
    echo "stage: $stage (no change yet)"
    echo "next: bash scripts/ship/wait-for-next-stage.sh $sha --from $stage"
    exit 0
  fi
  sleep "$interval_s"
  waited=$((waited + interval_s))
done

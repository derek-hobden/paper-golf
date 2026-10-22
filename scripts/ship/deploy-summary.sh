#!/usr/bin/env bash
# The one line every Deploy run ends with, in the run's job summary:
#
#   LIVE <production url> <sha>   the promote and its smoke passed
#   FAILED <job>                  the first job that failed, was cancelled or timed out
#   NO DEPLOY <why>               this CI run deploys nothing (not green, not main's tip, …).
#                                 Not in the spec's LIVE/FAILED pair, but a run that deployed
#                                 nothing is neither, and silence reads as a lost deploy.
#
#   PREPARE=… STAGING=… PRODUCTION=… DEPLOY=… SHA=… URL=… bash scripts/ship/deploy-summary.sh
#
# Reads the needs.<job>.result of each deploy job and prepare's own verdict, writes the
# line to $GITHUB_STEP_SUMMARY when it is set, and prints it either way. It never fails a
# run: a summary is a report, not a gate. CLAUDE.md "Ship process".
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,14p' "$0"; exit 0 ;; esac

prepare="${PREPARE:-}"
staging="${STAGING:-}"
production="${PRODUCTION:-}"
deploy="${DEPLOY:-}"
sha="${SHA:-unknown}"
url="${URL:-}"

if [ "$production" = success ]; then
  line="LIVE ${url:-unknown} $sha"
elif [ "$prepare" = failure ] || [ "$prepare" = cancelled ]; then
  line="FAILED prepare"
elif [ "$staging" = failure ] || [ "$staging" = cancelled ]; then
  line="FAILED staging"
elif [ "$production" = failure ] || [ "$production" = cancelled ]; then
  line="FAILED production"
elif [ "$prepare" = skipped ]; then
  line="NO DEPLOY (this CI run is not a green main commit)"
elif [ "$deploy" != true ]; then
  line="NO DEPLOY (the gate says this run deploys nothing)"
else
  line="NO DEPLOY (nothing ran: prepare=$prepare staging=$staging production=$production)"
fi

[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$line" >>"$GITHUB_STEP_SUMMARY"
echo "$line"
exit 0

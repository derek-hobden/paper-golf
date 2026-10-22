#!/usr/bin/env bash
# The one line a Deploy run ends with, in the run's job summary. There are exactly two:
#
#   LIVE <production url> <sha>   the promote and its smoke passed
#   FAILED <job>                  the first job that failed, was cancelled or timed out
#
# A run that deployed nothing is neither, and prints nothing at all.
#
#   PREPARE=… STAGING=… PRODUCTION=… SHA=… URL=… bash scripts/ship/deploy-summary.sh
#
# Reads the needs.<job>.result of each deploy job, writes the line to $GITHUB_STEP_SUMMARY
# when it is set, and prints it either way. It never fails a run: a summary is a report,
# not a gate. CLAUDE.md "Ship process".
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,13p' "$0"; exit 0 ;; esac

prepare="${PREPARE:-}"
staging="${STAGING:-}"
production="${PRODUCTION:-}"
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
else
  # This run deployed nothing (not green, not main's tip, the gate said no): no line.
  exit 0
fi

[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "$line" >>"$GITHUB_STEP_SUMMARY"
echo "$line"
exit 0

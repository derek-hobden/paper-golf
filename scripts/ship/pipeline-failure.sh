#!/usr/bin/env bash
# Open a GitHub issue for a post-merge staging, production or rollback failure.
# Pull-request check failures do not call this. Mentions @derek-hobden.
#
#   STAGING_RESULT=failure PRODUCTION_RESULT=success SHA=<sha> RUN_URL=<url> \
#     bash scripts/ship/pipeline-failure.sh
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,6p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

stage=""
[ "${STAGING_RESULT:-}" = failure ] && stage="staging"
if [ "${PRODUCTION_RESULT:-}" = failure ]; then
  if [ -n "$stage" ]; then stage="$stage and production"; else stage="production"; fi
fi
[ -n "$stage" ] || { echo "pipeline-failure: nothing failed"; exit 0; }

sha="${SHA:-unknown}"
run_url="${RUN_URL:-}"
title="pipeline failure: $stage ${sha:0:12}"
gh label create pipeline-failure --color b60205 --description "staging, production or rollback failed" --force >/dev/null
body="$(mktemp)"
cat >"$body" <<EOF
@derek-hobden

Post-merge **$stage** failed for \`$sha\`.

Production's failure includes the rollback step: the job rolls Vercel back to the last good deployment and then fails.

Run: $run_url
EOF
gh issue create --repo "$SHIP_REPO" --title "$title" --label pipeline-failure --body-file "$body" >/dev/null
rm -f "$body"
echo "pipeline-failure: opened ($title)"

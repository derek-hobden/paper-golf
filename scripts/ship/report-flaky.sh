#!/usr/bin/env bash
# Open or update a GitHub issue for each test that failed and then passed on
# its one automatic retry. The title is "flaky test: <name>", the label is flaky.
# Nothing is skipped or quarantined. A missing or empty file exits 0.
#
#   bash scripts/ship/report-flaky.sh <json-file>
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,7p' "$0"; exit 0 ;; esac
[ $# -eq 1 ] || { echo "usage: report-flaky.sh <json-file>" >&2; exit 2; }
file="$1"
[ -f "$file" ] || { echo "flaky: no $file"; exit 0; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

count="$(jq 'length' "$file")"
[ "$count" -gt 0 ] || { echo "flaky: none"; exit 0; }

gh label create flaky --color d93f0b --description "passed only on a retry" --force >/dev/null
open_issues="$(gh issue list --repo "$SHIP_REPO" --state open --limit 100 --json number,title --label flaky)"
sha="${GITHUB_SHA:-unknown}"
run_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$SHIP_REPO}/actions/runs/${GITHUB_RUN_ID:-0}"

i=0
while [ "$i" -lt "$count" ]; do
  name="$(jq -r ".[$i]" "$file")"
  i=$((i + 1))
  if [ -z "$name" ] || [ "$name" = null ]; then continue; fi
  title="flaky test: $name"
  number="$(jq -r --arg t "$title" '[.[] | select(.title == $t)][0].number // empty' <<<"$open_issues")"
  body="$(mktemp)"
  cat >"$body" <<EOF
The test \`$name\` failed and then passed on its one automatic retry.

It still runs on every build. Nothing is skipped or quarantined.

SHA: \`$sha\`
Run: $run_url
EOF
  if [ -n "$number" ]; then
    gh issue comment "$number" --repo "$SHIP_REPO" --body-file "$body" >/dev/null
    echo "flaky: updated #$number ($title)"
  else
    gh issue create --repo "$SHIP_REPO" --title "$title" --label flaky --body-file "$body" >/dev/null
    echo "flaky: opened ($title)"
  fi
  rm -f "$body"
done

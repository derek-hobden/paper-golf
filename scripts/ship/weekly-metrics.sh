#!/usr/bin/env bash
# Write one GitHub issue for this ISO week's deploy numbers: deploys per day,
# mean merge-to-production time, failed release share and recovery time.
# The past seven days, from the Deploy workflow's jobs. API calls only.
#
#   bash scripts/ship/weekly-metrics.sh
#   WEEKLY_INPUT=fixture.json bash scripts/ship/weekly-metrics.sh
#
# WEEKLY_INPUT skips the API and reads {"now","deploys":[{sha,conclusion,started_at,completed_at,committed_at}]}.
# Always creates or updates the issue titled "pipeline metrics: <year>-W<week>".
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,9p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

if [ -n "${WEEKLY_INPUT:-}" ]; then
  now="$(jq -r '.now' "$WEEKLY_INPUT")"
  deploys="$(jq '.deploys' "$WEEKLY_INPUT")"
else
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  since="$(date -u -d "$now - 7 days" +%Y-%m-%dT%H:%M:%SZ)"
  raw="$(gh api "/repos/$SHIP_REPO/actions/workflows/deploy.yml/runs?per_page=100" --jq '.workflow_runs')"
  runs="$(jq --arg since "$since" '[.[] | select(.created_at >= $since)]' <<<"$raw")"
  deploys='[]'
  count="$(jq 'length' <<<"$runs")"
  i=0
  while [ "$i" -lt "$count" ]; do
    id="$(jq -r ".[$i].id" <<<"$runs")"
    sha="$(jq -r ".[$i].head_sha" <<<"$runs")"
    i=$((i + 1))
    jobs="$(gh api "/repos/$SHIP_REPO/actions/runs/$id/jobs" --jq '.jobs')" || continue
    prod="$(jq '[.[] | select(.name == "production" and (.conclusion == "success" or .conclusion == "failure"))][0] // empty' <<<"$jobs")"
    [ -n "$prod" ] || continue
    conclusion="$(jq -r '.conclusion' <<<"$prod")"
    started="$(jq -r '.started_at' <<<"$prod")"
    completed="$(jq -r '.completed_at' <<<"$prod")"
    committed=""
    if [ "$conclusion" = success ]; then
      committed="$(gh api "/repos/$SHIP_REPO/commits/$sha" --jq '.commit.committer.date')" || committed=""
    fi
    deploys="$(jq --arg sha "$sha" --arg conclusion "$conclusion" --arg started "$started" --arg completed "$completed" --arg committed "$committed" \
      '. + [{sha:$sha, conclusion:$conclusion, started_at:$started, completed_at:$completed, committed_at:$committed}]' <<<"$deploys")"
  done
fi

week="$(date -u -d "$now" +%G-W%V)"
title="pipeline metrics: $week"
body="$(mktemp)"
jq -r --arg week "$week" --arg now "$now" '
  def mins($a; $b):
    if ($a | length) == 0 or ($b | length) == 0 then null
    else ((($b | fromdateiso8601) - ($a | fromdateiso8601)) / 60 | floor)
    end;
  def avg($xs; $noun):
    if ($xs | length) == 0 then "none"
    else "mean \(($xs | add) / ($xs | length) | floor) minutes over \($xs | length) \($noun)"
    end;
  . as $all
  | [$all[] | select(.conclusion == "success")] as $ok
  | [$all[] | select(.conclusion == "failure")] as $bad
  | ($all | length) as $n
  | ($bad | length) as $nf
  | ([$ok[] | mins(.committed_at; .completed_at) | select(. != null)]) as $merge
  | ([$bad[] | mins(.started_at; .completed_at) | select(. != null)]) as $recover
  | (if $n == 0 then "none" else "\($nf) of \($n) production deploys failed (\(($nf * 100) / $n | floor)%)" end) as $share
  | (if ($ok | length) == 0 then "none"
     else ($ok | group_by(.completed_at[0:10]) | map("\(.[0].completed_at[0:10]): \(length)") | join("\n"))
     end) as $perday
  | "## Pipeline metrics \($week)\n\nWindow: the 7 days ending \($now).\n\n### Deploys per day\n\($perday)\n\n### Merge-to-production\n\(avg($merge; "successful production deploys"))\n\n### Failed release share\n\($share)\n\n### Recovery time\n\(avg($recover; "failed production deploys (the job rolls back before it finishes)"))\n"
' <<<"$deploys" >"$body"

existing="$(gh issue list --repo "$SHIP_REPO" --label pipeline-metrics --state all --limit 50 --json number,title)"
number="$(jq -r --arg t "$title" '[.[] | select(.title == $t)][0].number // empty' <<<"$existing")"
if [ -n "$number" ]; then
  gh issue edit "$number" --repo "$SHIP_REPO" --body-file "$body" >/dev/null
  echo "pipeline metrics: updated #$number ($title)"
else
  gh label create pipeline-metrics --color 1d76db --description "weekly deploy numbers" --force >/dev/null
  gh issue create --repo "$SHIP_REPO" --title "$title" --label pipeline-metrics --body-file "$body" >/dev/null
  echo "pipeline metrics: opened ($title)"
fi
rm -f "$body"

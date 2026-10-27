#!/usr/bin/env bash
# Before the explainer video spends anything: is there a passed Claude review
# for the commit the recording shows, and what did the rounds before it find?
# Review first, then the video (AGENTS.md "Paid jobs").
#
#   GH_TOKEN=<read token> SHIP_REPO=<owner/repo> PR=<number> RUN_HEAD_SHA=<sha> \
#     bash scripts/ship/review-findings.sh <out-dir>
#
# The recorder is the pull request's own workflow, so it is not what decides
# that a review passed. This is: main's copy, run by the publish workflow's
# make job, which never runs the head. It finds the findings files the review
# kept as artifacts (claude-review-findings-<pr>-<sha7>, one lookup per commit
# of the pull request, newest first) and trusts one only when the run that
# uploaded it is really the review: `.github/workflows/claude-review.yml`, on
# `pull_request_target` (which always runs main's copy) or a `workflow_dispatch`
# of main — a pull request's own workflow could upload an artifact by the same
# name, and is skipped with a warning. The newest trusted one has to name this
# pull request, have `blocking` 0, and have read RUN_HEAD_SHA or a commit it
# still covers (review-state.sh covers: docs only or clean merges of main since).
#
# Writes, in <out-dir>:
#   passed.json  that findings file
#   counts       review_run=<the run id: one video per passed review>
#                round=<the passing round>
#                found=<the blocking problems the earlier rounds since the last
#                       ready mark found, by kind, e.g. "bug:2 rule:1"; all fixed>
#                fixed=<how many that is>
#                notes=<the notes (NITs) the passing round left>
# Only kinds and counts leave here. A finding's own words are model output from
# a model that read an untrusted diff: they never reach the narration.
#
# Exit 0 with both files written, 1 with the reason when there is no passed
# review for that commit (or it cannot be read: in doubt, no video), 2 on usage.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,34p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

[ $# -eq 1 ] || { echo "usage: review-findings.sh <out-dir> (see --help)" >&2; exit 2; }
out="$1"
case "${PR:-}" in '' | *[!0-9]*) echo "PR must be a pull request number" >&2; exit 2 ;; esac
[[ "${RUN_HEAD_SHA:-}" =~ ^[0-9a-f]{7,40}$ ]] || { echo "RUN_HEAD_SHA is not a commit sha" >&2; exit 2; }
ship_need gh jq unzip
mkdir -p "$out"

REVIEW_WORKFLOW=.github/workflows/claude-review.yml
FINDINGS_FILE=claude-review-findings.json
# Head-first and no further, like the gate.
MAX_COMMITS=30
# Earlier rounds read for what they found; more than this is never one ready mark.
MAX_ROUNDS_READ=6

refuse() {
  echo "::error::no video: $1" >&2
  exit 1
}

base="$(gh api "/repos/$SHIP_REPO/pulls/$PR" --jq '.base.ref')" || refuse "could not read pull request $PR"
marked="$(ship_ready_mark "$PR")" || refuse "could not read when pull request $PR was last marked ready"
shas="$(gh api --paginate "/repos/$SHIP_REPO/pulls/$PR/commits" --jq '.[].sha')" ||
  refuse "could not read the commits of pull request $PR"
shas="$(printf '%s\n' "$shas" | grep -v '^$' |
  awk '{ a[NR] = $0 } END { for (i = NR; i > 0; i--) print a[i] }' | head -n "$MAX_COMMITS")"

# Every findings artifact of this pull request: "created id run" lines.
candidates=''
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  rows="$(gh api "/repos/$SHIP_REPO/actions/artifacts?name=claude-review-findings-$PR-${sha:0:7}&per_page=20" --jq '
    .artifacts[]? | select(.expired | not) | [.created_at, (.id | tostring), (.workflow_run.id | tostring)] | @tsv')" ||
    refuse "could not list the review findings for ${sha:0:7}"
  [ -z "$rows" ] || candidates="${candidates}${rows}"$'\n'
done <<<"$shas"
candidates="$(printf '%s' "$candidates" | grep -v '^$' | LC_ALL=C sort -r | awk -F'\t' '!seen[$2]++' || true)"

# genuine <run id>: is that run the Claude review itself?
genuine() {
  local row path event branch
  row="$(gh api "/repos/$SHIP_REPO/actions/runs/$1" --jq '[.path, .event, .head_branch] | @tsv')" || return 1
  IFS=$'\t' read -r path event branch <<<"$row"
  [ "$path" = "$REVIEW_WORKFLOW" ] || return 1
  case "$event" in
    pull_request_target) return 0 ;;
    workflow_dispatch) [ "$branch" = "$base" ] ;;
    *) return 1 ;;
  esac
}

# fetch <artifact id> <file>: the findings file out of that artifact's zip.
fetch() {
  local zip ok=0
  zip="$(mktemp)"
  if gh api "/repos/$SHIP_REPO/actions/artifacts/$1/zip" >"$zip" 2>/dev/null &&
    unzip -p "$zip" "$FINDINGS_FILE" >"$2" 2>/dev/null &&
    jq -e 'type == "object"' "$2" >/dev/null 2>&1; then
    ok=1
  fi
  rm -f "$zip"
  [ "$ok" = 1 ]
}

passed_run=''
earlier=()
n=0
while IFS=$'\t' read -r created id run; do
  [ -n "$id" ] || continue
  if ! genuine "$run"; then
    echo "::warning::review-findings: artifact $id (run $run) was not uploaded by $REVIEW_WORKFLOW on pull_request_target or a dispatch of $base, so it is ignored" >&2
    continue
  fi
  if [ -z "$passed_run" ]; then
    fetch "$id" "$out/passed.json" || refuse "could not read the findings of review run $run"
    passed_run="$run"
    continue
  fi
  # The rounds before it since the last ready mark, for what they found.
  [[ "$created" < "$marked" ]] && continue
  [ "${#earlier[@]}" -lt "$MAX_ROUNDS_READ" ] || continue
  n=$((n + 1))
  if fetch "$id" "$out/earlier-$n.json"; then earlier+=("$out/earlier-$n.json"); fi
done <<<"$candidates"

[ -n "$passed_run" ] || refuse "pull request $PR has no findings from a Claude review run of $REVIEW_WORKFLOW"
got_pr="$(jq -r '.pr // empty' "$out/passed.json")"
[ "$got_pr" = "$PR" ] || refuse "the newest review's findings name pull request ${got_pr:-none}, not $PR"
blocking="$(jq -r '.blocking | if type == "number" and . == floor and . >= 0 then tostring else "bad" end' "$out/passed.json")"
[ "$blocking" = 0 ] || refuse "the newest Claude review (run $passed_run) left $blocking blocking problem(s): it did not pass"
reviewed="$(jq -r '.head_sha // ""' "$out/passed.json")"
[[ "$reviewed" =~ ^[0-9a-f]{7,40}$ ]] || refuse "the newest review's findings name no commit"
rc=0
why="$(bash "$here/review-state.sh" covers "$reviewed" "$RUN_HEAD_SHA" "$base")" || rc=$?
[ "$rc" = 0 ] || refuse "the review that passed read ${reviewed:0:7}, and the recording shows ${RUN_HEAD_SHA:0:7}: ${why:-it does not cover it}"

round="$(jq -r '.round | if type == "number" and . == floor and . > 0 then tostring else "1" end' "$out/passed.json")"
notes="$(jq -r '[.findings[]? | select(.severity == "NIT")] | length' "$out/passed.json")"
# Each blocking problem once, however many rounds it stayed open (its link, or
# its place and words, is what makes it the same one). Only the kind is kept.
found=''
fixed=0
if [ "${#earlier[@]}" -gt 0 ]; then
  found="$(jq -rs '
    [.[] | .findings[]? | select(.severity == "BLOCKING")
      | {key: (if (.url // "") != "" then .url else "\(.path // ""):\(.body // "")" end),
         kind: (if (.kind // "") | test("^(bug|security|failing|rule)$") then .kind else "unknown" end)}]
    | unique_by(.key) | group_by(.kind) | map("\(.[0].kind):\(length)") | join(" ")' "${earlier[@]}")"
  fixed="$(jq -rs '[.[] | .findings[]? | select(.severity == "BLOCKING")
      | if (.url // "") != "" then .url else "\(.path // ""):\(.body // "")" end] | unique | length' "${earlier[@]}")"
fi
printf 'review_run=%s\nround=%s\nfound=%s\nfixed=%s\nnotes=%s\n' "$passed_run" "$round" "$found" "$fixed" "$notes" >"$out/counts"
cat "$out/counts"

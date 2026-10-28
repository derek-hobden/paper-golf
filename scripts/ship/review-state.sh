#!/usr/bin/env bash
# Where the Claude review stands on a pull request: the one answer the paid
# trigger, the gate, the signal and the video read (AGENTS.md "Paid jobs").
#
#   GH_TOKEN=... PR=<number> bash scripts/ship/review-state.sh
#   GH_TOKEN=... bash scripts/ship/review-state.sh covers <from> <to> <base ref>
#
# The first prints, and appends to $GITHUB_OUTPUT when set:
#   state=none|passed|stale-pass|changes-requested|broke
#   round=<reviews that asked for changes since the last ready mark>
#   reviewed=<the commit the latest review that counts read>
#   head=<the pull request's head>
#   covered=yes|no|unknown  (changes-requested only: is every commit since it
#           docs only or a clean merge of main?)
#   reason=<the same, in words>
#
# It reads the `claude-review` check runs completed since the last ready mark,
# titled `Claude review: passed`, `changes requested` or `broke`. A broken run
# is not a round and takes no pass away; an untitled failure from the older
# reviewer reads as changes requested.
#
# covers exits 0 when a review of <from> still stands for <to>: every commit on
# the first-parent path from <to> back to <from> is docs only (lib.sh
# ship_is_doc_path) or a clean merge of <base ref> (second parent on it, every
# file it brings in as that parent has it); 1 when one needs a review, 2 when
# the history cannot be read. Through the API only, never the head's code; the
# git form is lib.sh ship_video_stale.
#
# Exit 0 with an answer, 1 when the pull request cannot be read, 2 on usage.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,29p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

REVIEW_CHECK=claude-review
# A pull request is read head-first and no further than this, both for its
# reviews and for the commits a review still covers.
MAX_COMMITS=30
# GitHub lists at most this many files for one commit or comparison; one that
# big is never taken for docs only or a clean merge.
MAX_FILES=300


# The files a comparison changes, one "name status blob" line each, sorted.
compare_files() {
  gh api "/repos/$SHIP_REPO/compare/$1...$2" --jq '
    if ((.files // []) | length) >= '"$MAX_FILES"' then "too-many"
    else [(.files // [])[] | "\(.filename) \(.status) \(.sha // "")"] | sort | join("\n") end'
}

# covers <from> <to> <base ref>: see the header. Says why not on stdout.
covers() {
  local from="$1" to="$2" base="$3" c="$2" n=0 info p1 p2 count f status mine theirs
  while [ "$c" != "$from" ]; do
    n=$((n + 1))
    [ "$n" -le "$MAX_COMMITS" ] || { echo "more than $MAX_COMMITS commits lie between ${from:0:7} and ${to:0:7}"; return 2; }
    info="$(gh api "/repos/$SHIP_REPO/commits/$c" --jq '
      {p: [(.parents // [])[].sha], n: ((.files // []) | length),
       f: [(.files // [])[] | .filename, (.previous_filename // empty)]}' 2>/dev/null)" || {
      echo "cannot read commit ${c:0:7}"
      return 2
    }
    p1="$(jq -r '.p[0] // ""' <<<"$info")"
    p2="$(jq -r '.p[1] // ""' <<<"$info")"
    [ -n "$p1" ] || { echo "${from:0:7} is not on the first-parent history of ${to:0:7}"; return 1; }
    if [ -z "$p2" ]; then
      count="$(jq -r '.n' <<<"$info")"
      [ "$count" -lt "$MAX_FILES" ] || { echo "commit ${c:0:7} changes too many files to be docs only"; return 1; }
      while IFS= read -r f; do
        [ -n "$f" ] || continue
        ship_is_doc_path "$f" || { echo "commit ${c:0:7} changes $f, which is more than docs"; return 1; }
      done < <(jq -r '.f[]' <<<"$info")
    else
      status="$(gh api "/repos/$SHIP_REPO/compare/$p2...$base" --jq '.status' 2>/dev/null)" || {
        echo "cannot compare ${p2:0:7} with $base"
        return 2
      }
      case "$status" in
        ahead | identical) ;;
        *) echo "commit ${c:0:7} merges ${p2:0:7}, which is not on $base"; return 1 ;;
      esac
      mine="$(compare_files "$p1" "$c" 2>/dev/null)" || { echo "cannot read what commit ${c:0:7} changed"; return 2; }
      theirs="$(compare_files "$p1" "$p2" 2>/dev/null)" || { echo "cannot read what $base brought in"; return 2; }
      if [ "$mine" = too-many ] || [ "$mine" != "$theirs" ]; then
        echo "commit ${c:0:7} merges $base and changes more than $base brought in"
        return 1
      fi
    fi
    c="$p1"
  done
  return 0
}

if [ "${1:-}" = covers ]; then
  [ $# -eq 4 ] || { echo "usage: review-state.sh covers <from> <to> <base ref> (see --help)" >&2; exit 2; }
  rc=0
  why="$(covers "$2" "$3" "$4")" || rc=$?
  [ -z "$why" ] || printf '%s\n' "$why"
  exit "$rc"
fi
[ $# -eq 0 ] || { echo "usage: review-state.sh (see --help)" >&2; exit 2; }
case "${PR:-}" in '' | *[!0-9]*) echo "PR must be a pull request number" >&2; exit 2 ;; esac

answer() {
  local lines
  lines="$(printf 'state=%s\nround=%s\nreviewed=%s\nhead=%s\ncovered=%s\nreason=%s\n' "$1" "$round" "$2" "$head" "${covered:-}" "$3")"
  printf '%s\n' "$lines"
  [ -z "${GITHUB_OUTPUT:-}" ] || printf '%s\n' "$lines" >>"$GITHUB_OUTPUT"
  exit 0
}

row="$(gh api "/repos/$SHIP_REPO/pulls/$PR" --jq '[.head.sha, .base.ref] | @tsv')" || {
  echo "cannot read pull request $PR" >&2
  exit 1
}
IFS=$'\t' read -r head base <<<"$row"
marked="$(ship_ready_mark "$PR")" || { echo "cannot read when pull request $PR was last marked ready" >&2; exit 1; }
shas="$(gh api --paginate "/repos/$SHIP_REPO/pulls/$PR/commits" --jq '.[].sha')" || {
  echo "cannot read the commits of pull request $PR" >&2
  exit 1
}
# Newest first; awk, not tac, which macOS lacks.
shas="$(printf '%s\n' "$shas" | grep -v '^$' |
  awk '{ a[NR] = $0 } END { for (i = NR; i > 0; i--) print a[i] }' | head -n "$MAX_COMMITS")"

# One "completed_at state sha" line per review since the ready mark.
reviews=''
while IFS= read -r sha; do
  [ -n "$sha" ] || continue
  # filter=all: GitHub answers only the latest run of each name by default, so a
  # review that asked for changes and then a second review that passed on the
  # same commit read as one pass, and the round counted none (PR 73: "round 1"
  # in its status comment and its video after a round had asked for changes).
  # Every review leaves two runs of that name: the job's own, untitled, and the
  # verdict it records, titled "Claude review: ...". Where a titled run is on the
  # commit the untitled ones are not counted again, or one review asking for
  # changes was two rounds (PR 85: "Passed (round 3, ...)" after one).
  # A titled verdict can also be copied: re-running a failed Ready gate run on
  # the same commit left a second "changes requested" run there (PR 76, issue
  # 92: run 40771094867 recorded 123108868573, and 123109033980 appeared as the
  # gate re-ran). A review is one job, so where the commit has job runs (not
  # skipped) it keeps no more verdicts than jobs, the earliest first. A verdict
  # with no job on its commit (the dispatch records it on the head while its job
  # ran on main) is kept, as before.
  rows="$(gh api "/repos/$SHIP_REPO/commits/$sha/check-runs?check_name=$REVIEW_CHECK&filter=all&per_page=100" --jq '
    [.check_runs[]? | select(.status == "completed")]
    | {runs: ., jobs: ([.[] | select((.output.title // "") == "" and .conclusion != "skipped")] | length)}
    | if any(.runs[]; (.output.title // "") | startswith("Claude review:"))
      then .runs |= (map(select((.output.title // "") != "")) | sort_by(.completed_at // ""))
        | if .jobs > 0 then .runs[:.jobs] else .runs end
      else .runs end
    | .[] | [(.completed_at // ""), (.conclusion // ""), (.output.title // ""), .head_sha] | @tsv')" || {
    echo "cannot read the check runs on $sha" >&2
    exit 1
  }
  while IFS=$'\t' read -r when conclusion title on; do
    [ -n "$when" ] || continue
    ! [[ "$when" < "$marked" ]] || continue
    if [ "$conclusion" = success ]; then
      kind=passed
    elif [ "$title" = "Claude review: broke" ] || [ "$conclusion" = cancelled ] ||
      [ "$conclusion" = skipped ] || [ "$conclusion" = neutral ]; then
      kind=broke
    else
      kind=changes-requested
    fi
    reviews="${reviews}${when} ${kind} ${on:-$sha}"$'\n'
  done <<<"$rows"
done <<<"$shas"
reviews="$(printf '%s' "$reviews" | grep -v '^$' | LC_ALL=C sort -r || true)"

round="$(printf '%s\n' "$reviews" | awk '$2 == "changes-requested"' | grep -c . || true)"
latest="$(printf '%s\n' "$reviews" | awk '$2 != "broke"' | head -n 1)"
if [ -z "$latest" ]; then
  if [ -n "$reviews" ]; then
    answer broke '' "the Claude review broke since this pull request was last marked ready, and none has finished"
  fi
  answer none '' "no Claude review has finished since this pull request was last marked ready at $marked"
fi
read -r _ kind reviewed <<<"$latest"
if [ "$kind" = changes-requested ]; then
  rc=0
  covers "$reviewed" "$head" "$base" >/dev/null || rc=$?
  case "$rc" in 0) covered=yes ;; 1) covered=no ;; *) covered=unknown ;; esac
  answer changes-requested "$reviewed" "the latest Claude review, of ${reviewed:0:7}, asked for changes (round $round)"
fi
rc=0
why="$(covers "$reviewed" "$head" "$base")" || rc=$?
if [ "$rc" = 0 ]; then
  answer passed "$reviewed" "the latest Claude review passed on ${reviewed:0:7} and covers the head ${head:0:7}"
fi
answer stale-pass "$reviewed" "the latest Claude review passed on ${reviewed:0:7}, but ${why:-a later commit needs a review of its own}"

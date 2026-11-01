#!/usr/bin/env bash
# The PR explainer-video check. CI records each ready pull request's explainer
# video, narrates it and hosts it as an asset on one of the PR video shelves
# (the month's `pr-videos-YYYY-MM` prerelease, its `-N` rolls, or the legacy
# `pr-videos`), then writes the link as the very first line of the body
# (AGENTS.md "PR explainer videos"). That video is best effort and never holds
# a merge (Derek, 1 Nov 2026): this check never judges it.
#
#   PR_ACTOR=<login> PR_DRAFT=<true|false> PR_BODY=<body> [SHIP_REPO=<owner/repo>] \
#     bash scripts/ship/pr-video.sh <base> <head>
#
# It fails for two things only:
#   - the diff adds a video to the pull request itself: a pr-explainer-* file
#     with the extension mp4, mov, webm, txt or md, a root video.mp4, or
#     anything under qa-video/ or docs/pr-videos/. The video is never a file in
#     the pull request, review or no review.
#   - the Claude review has not passed yet, given PR_LABELS (the pull request's
#     labels, comma-separated; the workflow always hands them in, and given the
#     API they are read live too): without the review-passed label there is no
#     video yet on purpose, and the check says "Waiting for the review to pass
#     (no video until then)". A ready pull request with no `## How to see it`
#     step (PR_VIDEO_NEEDS_STEPS=1, as pr-video.yml sets it) fails at once
#     until then, with an example to paste.
# Once the review has passed it passes, whatever the video does. What is wrong
# with the video is a note — a ::warning:: line and a line in the step summary
# (lib.sh ship_video_warning) — never a red: no link on the first non-empty
# line of PR_BODY, a link that is not an asset on a shelf of SHIP_REPO, or,
# given PR_NUMBER, a link that is not this pull request's pr-<n>-<sha7>.mp4 or
# a video that does not stand for the head (lib.sh ship_video_stale: the head,
# or followed only by docs-only commits and clean merges of main, BASE_TIP,
# default origin/main). Nothing waits for a video still being made, and the
# notes never ask for a remake: a video is never remade to get a merge through.
#
# A draft passes: a draft is how you work in progress, and the paid jobs that
# make the video only run once the pull request is marked ready for review.
# dependabot[bot] and renovate[bot] are exempt, because they get no video
# either.
#
# Given the API (GH_TOKEN and PR_NUMBER), the body, the draft state and the
# labels are read live first, not taken from the event (a re-run reuses its old
# event, and the review re-runs this check's failed run once it passes); a pull
# request that cannot be read fails closed. Reads only: no write.
# Exit 0 when the PR passes, 1 when it does not, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
# shellcheck source=scripts/ship/pr-body-sections.sh
. "$here/pr-body-sections.sh"
[ $# -eq 2 ] || { echo "usage: pr-video.sh <base> <head> (see --help)" >&2; exit 2; }
base="$1"
head="$2"

case "${PR_ACTOR:-}" in
  'dependabot[bot]' | 'renovate[bot]')
    echo "pr-video: $PR_ACTOR is exempt"
    exit 0
    ;;
esac

# Given the API, the pull request as it is now, not as the event saw it: a
# re-run reuses its original event, so PR_BODY, PR_DRAFT and PR_LABELS can be
# from before the review passed or the link went up. A pull request that
# cannot be read fails closed rather than trust the event.
if [ -n "${GH_TOKEN:-}" ] && [[ "${PR_NUMBER:-}" =~ ^[0-9]+$ ]]; then
  if ! live="$(gh api "/repos/$SHIP_REPO/pulls/$PR_NUMBER" \
    --jq '{draft: (.draft // false), body: (.body // ""), labels: ([.labels[]?.name] | join(","))}')" ||
    ! PR_DRAFT="$(jq -r '.draft' <<<"$live")" || ! PR_BODY="$(jq -r '.body' <<<"$live")"; then
    echo "pr-video: cannot read pull request $PR_NUMBER, so its live body cannot be checked; re-run this job" >&2
    exit 1
  fi
  # The labels too, when the workflow handed some in: a re-run of this check
  # after the review passed has to see the review-passed label its old event
  # did not carry.
  if [ -n "${PR_LABELS+set}" ] && ! PR_LABELS="$(jq -r '.labels' <<<"$live")"; then
    echo "pr-video: cannot read the labels of pull request $PR_NUMBER; re-run this job" >&2
    exit 1
  fi
fi

# Only files the diff adds: removing an explainer that is already in the repo is
# the fix, not the offence. --no-renames so a `git mv` into a banned path is the
# add of a new path and not an R the filter drops, and -z so a non-ASCII name
# arrives raw instead of C-quoted ("qa-video/\303\251.mp4"), where the leading
# quote would stop every pattern below matching.
# The list goes through a file, not a command substitution: a NUL cannot survive
# in a shell variable.
added="$(mktemp)"
trap 'rm -f "$added"' EXIT
git diff --no-renames --diff-filter=A -z --name-only "$base" "$head" >"$added" ||
  { echo "cannot read the diff $base $head" >&2; exit 1; }

problems=''
note() { problems="${problems}  - $1"$'\n'; }

# An explainer is an explainer in any case, so match a lowercased copy and report
# the real path.
while IFS= read -r -d '' f; do
  [ -n "$f" ] || continue
  lower="$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    qa-video/*) note "$f is under qa-video/"; continue ;;
    docs/pr-videos/*) note "$f is under docs/pr-videos/"; continue ;;
    # The explainer itself, by the name the recording uses. CI hosts it on the
    # releases page; it never belongs in the repository's own tree.
    video.mp4) note "$f is the explainer video: CI hosts it, the pull request does not carry it"; continue ;;
  esac
  case "${lower##*/}" in
    pr-explainer-*.mp4 | pr-explainer-*.mov | pr-explainer-*.webm | pr-explainer-*.txt | pr-explainer-*.md)
      note "$f is a pr-explainer-* file" ;;
  esac
done <"$added"

# A draft has no video yet, on purpose: the paid jobs run when it is marked
# ready. The banned-file rules above still apply — a video committed to a draft
# is still a video committed to the pull request.
draft=0
[ "${PR_DRAFT:-}" != true ] || draft=1

# Where the review stands, when the workflow says (PR_LABELS): passed is the
# review-passed label; anything else on a ready pull request is waiting.
passed=0
waiting=0
if [ "$draft" = 0 ] && [ -n "${PR_LABELS+set}" ]; then
  case ",${PR_LABELS}," in
    *",$SHIP_REVIEW_PASSED_LABEL,"*) passed=1 ;;
    *) waiting=1 ;;
  esac
fi

# The video's own problems, said and never failed on (the video is best effort).
video_notes=''
video_note() {
  video_notes="${video_notes}$1"$'\n'
}

# The steps CI films (PR_VIDEO_NEEDS_STEPS=1, as pr-video.yml sets it): a ready
# pull request with no `## How to see it` step fails here, at once, with an
# example to paste, until its review has passed; a draft is warned, and after
# the pass it is a note. Steps CI cannot follow still never fail.
if [ "${PR_VIDEO_NEEDS_STEPS:-}" = 1 ] && [ -z "$(ship_body_steps "${PR_BODY:-}")" ]; then
  if [ "$draft" = 1 ]; then
    printf '::warning title=How to see it::pr-video: %s. %s\n' "$SHIP_STEPS_REASON" "${SHIP_STEPS_EXAMPLE//$'\n'/%0A}"
  elif [ "$passed" = 1 ]; then
    video_note "$SHIP_STEPS_REASON, so the video has no steps to film"
  else
    printf 'pr-video: %s\n\n%s\n' "$SHIP_STEPS_REASON" "$SHIP_STEPS_EXAMPLE" >&2
    bash "$here/check-summary.sh" pr-video "$SHIP_STEPS_REASON" "$SHIP_STEPS_NEXT"
    exit 1
  fi
fi

# No pass yet, so no video yet: that is the order, not a fault of the body.
[ "$waiting" = 0 ] || note "Waiting for the review to pass (no video until then)"

# head_note <url>: given the pull request number (the workflow always hands it
# in), whether the video stands for the head commit (lib.sh ship_video_stale):
# its asset is pr-<PR_NUMBER>-<sha7>.mp4, and that commit is the head or is
# followed only by docs-only commits and clean merges of main (BASE_TIP, the
# base branch tip). Prints what is not so, or nothing.
head_note() {
  local asset_name n sha7 v head_sha why rc
  [ -n "${PR_NUMBER:-}" ] || return 0
  asset_name="${1##*/}"
  if ! [[ "$asset_name" =~ ^pr-([0-9]+)-([0-9a-f]{7})[.]mp4$ ]]; then
    echo "the video link names no pull request and commit (pr-<n>-<sha7>.mp4): $asset_name"
    return 0
  fi
  n="${BASH_REMATCH[1]}"
  sha7="${BASH_REMATCH[2]}"
  if [ "$n" != "$PR_NUMBER" ]; then
    echo "the video link is $asset_name, the video of another pull request; this is pull request $PR_NUMBER"
    return 0
  fi
  head_sha="$(git rev-parse --verify --quiet "$head^{commit}" 2>/dev/null || true)"
  [ -n "$head_sha" ] || { echo "cannot read the head commit $head, so it cannot be told whether the video stands for the head"; return 0; }
  case "$head_sha" in "$sha7"*) return 0 ;; esac
  v="$(git rev-parse --verify --quiet "$sha7^{commit}" 2>/dev/null || true)"
  if [ -z "$v" ]; then
    echo "the video shows $sha7, which is not in this branch's history (was the branch rewritten?): the video is not of this head"
    return 0
  fi
  rc=0
  why="$(ship_video_stale "$v" "$head_sha" "${BASE_TIP:-origin/main}")" || rc=$?
  case "$rc" in
    0) ;;
    1) echo "$why: the video is of an older commit, not this head" ;;
    *) echo "$why, so it cannot be told whether the video stands for the head" ;;
  esac
}

# link_note <body>: what is wrong with the body's video link, or nothing.
link_note() {
  local url asset
  # The first line of the body with something on it, out of the markdown a body
  # commonly wraps a link in: a wrapped link to the right video is fine. lib.sh
  # reads it, so the tidy-up reads the same link.
  url="$(ship_video_body_link "$1")"
  # This repository's own shelves, any of them. Another repository running this
  # pipeline is handed its own name as SHIP_REPO (docs/pipeline-rollout.md).
  asset="$(ship_video_link_re "$SHIP_REPO")"
  if [[ "$url" =~ $asset ]]; then
    head_note "$url"
  elif [ -z "$url" ]; then
    echo "the PR body is empty, so there is no video link on its first line"
  else
    echo "the first non-empty line of the PR body is not an explainer link on a $SHIP_REPO video shelf ($SHIP_VIDEO_SHELF_PREFIX-YYYY-MM, a roll of it, or the legacy $SHIP_VIDEO_SHELF_PREFIX): $url"
  fi
}

if [ "$draft" = 0 ] && [ "$waiting" = 0 ]; then
  link="$(link_note "${PR_BODY:-}")"
  [ -z "$link" ] || video_note "$link"
fi

if [ -z "$problems" ]; then
  if [ "$draft" = 1 ]; then
    echo "pr-video: draft, so no video yet"
  elif [ -n "$video_notes" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] || ship_video_warning "pr-video: $line"
    done <<<"$video_notes"
    echo "pr-video: ok (the explainer video is best effort and never holds a merge: ${video_notes%%$'\n'*})"
  else
    echo "pr-video: ok"
  fi
  exit 0
fi

if [ "$waiting" = 1 ] && [ "$problems" = "  - Waiting for the review to pass (no video until then)"$'\n' ]; then
  {
    echo "pr-video: not yet."
    printf '%s' "$problems"
    echo
    echo "The video comes after the Claude review: once a review passes, the review-passed label goes on and"
    echo "this check passes, video or none (the video is best effort and never holds a merge). CI then films"
    echo "and narrates the walkthrough and writes the link as the first line of this body."
    echo "If the review asked for changes, its Problems found comment on this pull request lists them."
    echo "AGENTS.md \"Paid jobs\"."
  } >&2
  exit 1
fi

{
  echo "pr-video: this pull request does not follow the explainer-video rule."
  printf '%s' "$problems"
  echo
  echo "A PR explainer video is never committed to the pull request, and nobody records one by hand:"
  echo "remove the file. CI makes it:"
  echo "  1. open the pull request (a draft while you work) and write a ## How to see it section."
  echo "  2. mark it ready for review, or add the \`ready\` label; once the Claude review passes, CI records"
  echo "     the walkthrough, narrates it, hosts it on GitHub, and writes the link as the first line of this body."
  echo "The video is best effort and never holds a merge: never re-run or remake it to get a merge through."
  echo "That link is a bare https://github.com/$SHIP_REPO/releases/download/<shelf>/pr-<n>-<sha>.mp4 URL"
  echo "at the very top of the body, above the --- divider, where <shelf> is"
  echo "$SHIP_VIDEO_SHELF_PREFIX-YYYY-MM, a roll of it ($SHIP_VIDEO_SHELF_PREFIX-YYYY-MM-2 and on) or the legacy $SHIP_VIDEO_SHELF_PREFIX: an asset"
  echo "on a shelf prerelease is reachable through a documented API, costs nothing, and stays after"
  echo "the pull request merges."
  echo "A product video elsewhere in the repo is fine: this rule is only about the"
  echo "explainer video for a pull request. AGENTS.md \"PR explainer videos\"."
} >&2
first_problem="${problems%%$'\n'*}"
bash "$here/check-summary.sh" pr-video "${first_problem#  - }"
exit 1

#!/usr/bin/env bash
# The PR explainer-video check. Every pull request that is ready for review
# opens with a link to its explainer video, and that video is never a file in
# the pull request: CI records it, narrates it and hosts it as an asset on one
# of the PR video shelves (the month's `pr-videos-YYYY-MM` prerelease, its
# `-N` rolls, or the legacy `pr-videos`), then writes the link as the very first
# line of the body (AGENTS.md "PR explainer videos").
#
#   PR_ACTOR=<login> PR_DRAFT=<true|false> PR_BODY=<body> [SHIP_REPO=<owner/repo>] \
#     bash scripts/ship/pr-video.sh <base> <head>
#
# Fails when the diff adds a pr-explainer-* file with the extension mp4, mov,
# webm, txt or md, a root video.mp4, anything under qa-video/ or
# docs/pr-videos/; or when the first non-empty line of PR_BODY is not an asset
# link on a shelf of SHIP_REPO, the link CI leaves there. Given PR_NUMBER (the
# workflow always hands it in) the link has to be this pull request's
# pr-<n>-<sha7>.mp4, and that commit's video has to stand for the head: it is
# the head, or every commit after it on the first-parent path is docs only
# (*.md anywhere, or under docs/) or a clean merge of main (BASE_TIP, default
# origin/main). Anything else needs a new video; history that cannot be read
# fails closed.
#
# A draft passes: a draft is how you work in progress, and the paid jobs that
# make the video only run once the pull request is marked ready for review.
# dependabot[bot] and renovate[bot] are exempt, because they get no video
# either.
#
# Given the API (GH_TOKEN and PR_NUMBER), the body and the draft state are read
# live first, not taken from the event (a re-run reuses its old event).
# The ready mark starts the recording and this check at once. Given the API,
# when the only
# problem is that the body's first line is no video link yet and a PR video
# record or publish run for the head is queued or in progress, it waits for it
# (lib.sh ship_wait_next: 15 s, doubling to 60 s, 10 minutes at most),
# re-reading the body each time, and passes as soon as the link is there. Any
# other red fails at once. Reads only: no write.
# Exit 0 when the PR passes, 1 when it does not, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,37p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
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
# re-run reuses its original event, so PR_BODY and PR_DRAFT can be from before
# the link went up. Read again on every poll below. A pull request that cannot
# be read fails closed rather than trust the event.
live_api=0
if [ -n "${GH_TOKEN:-}" ] && [[ "${PR_NUMBER:-}" =~ ^[0-9]+$ ]]; then live_api=1; fi
read_live() {
  local live
  live="$(gh api "/repos/$SHIP_REPO/pulls/$PR_NUMBER" --jq '{draft: (.draft // false), body: (.body // "")}')" ||
    return 1
  PR_DRAFT="$(jq -r '.draft' <<<"$live")" || return 1
  PR_BODY="$(jq -r '.body' <<<"$live")" || return 1
}
if [ "$live_api" = 1 ] && ! read_live; then
  echo "pr-video: cannot read pull request $PR_NUMBER, so its live body cannot be checked; re-run this job" >&2
  exit 1
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

# head_problem <url>: given the pull request number (the workflow always hands
# it in), the video has to stand for the head commit (lib.sh ship_video_stale):
# its asset is pr-<PR_NUMBER>-<sha7>.mp4, and that commit is the head or is
# followed only by docs-only commits and clean merges of main (BASE_TIP, the
# base branch tip). Sets link when it does not. In doubt it fails.
head_problem() {
  local asset_name n sha7 v head_sha why rc
  [ -n "${PR_NUMBER:-}" ] || return 0
  asset_name="${1##*/}"
  if ! [[ "$asset_name" =~ ^pr-([0-9]+)-([0-9a-f]{7})[.]mp4$ ]]; then
    link="the video link names no pull request and commit (pr-<n>-<sha7>.mp4): $asset_name"
    return 0
  fi
  n="${BASH_REMATCH[1]}"
  sha7="${BASH_REMATCH[2]}"
  if [ "$n" != "$PR_NUMBER" ]; then
    link="the video link is $asset_name, the video of another pull request; this is pull request $PR_NUMBER"
    return 0
  fi
  head_sha="$(git rev-parse --verify --quiet "$head^{commit}" 2>/dev/null || true)"
  [ -n "$head_sha" ] || { link="cannot read the head commit $head, so the video cannot be checked against it"; return 0; }
  case "$head_sha" in "$sha7"*) return 0 ;; esac
  v="$(git rev-parse --verify --quiet "$sha7^{commit}" 2>/dev/null || true)"
  if [ -z "$v" ]; then
    link="the video shows $sha7, which is not in this branch's history (was the branch rewritten?): it needs a new video. To remake it, mark it ready again, or add the \`$SHIP_READY_LABEL\` label"
    return 0
  fi
  rc=0
  why="$(ship_video_stale "$v" "$head_sha" "${BASE_TIP:-origin/main}")" || rc=$?
  case "$rc" in
    0) ;;
    1) link="$why: it needs a new video. To remake it, mark it ready again, or add the \`$SHIP_READY_LABEL\` label" ;;
    *) link="$why, so the video cannot be shown to stand for the head (the check fails closed). Re-run this job; if it fails again, mark it ready again, or add the \`$SHIP_READY_LABEL\` label" ;;
  esac
}

# link_problem <body>: sets link to the problem with the body's video link,
# or empty, and link_waitable to 1 when the problem is only that there is no
# link yet.
link=''
link_waitable=0
link_problem() {
  local url asset
  link=''
  link_waitable=0
  # The first line of the body with something on it, out of the markdown a body
  # commonly wraps a link in: a wrapped link to the right video is not worth a
  # red check. lib.sh reads it, so the tidy-up reads the same link.
  url="$(ship_video_body_link "$1")"
  # This repository's own shelves, any of them. Another repository running this
  # pipeline is handed its own name as SHIP_REPO (docs/pipeline-rollout.md).
  asset="$(ship_video_link_re "$SHIP_REPO")"
  if [[ "$url" =~ $asset ]]; then
    head_problem "$url"
    return 0
  fi
  if [ -z "$url" ]; then
    link_waitable=1
    link="the PR body is empty: it must open with the video link"
    return 0
  fi
  case "$url" in http://* | https://*) ;; *) link_waitable=1 ;; esac
  link="the first non-empty line of the PR body is not an explainer link on a $SHIP_REPO video shelf: $url"
}

if [ "$draft" = 0 ]; then
  files_problems="$problems"
  link_problem "${PR_BODY:-}"
  # Wait for a video still being made, but only when nothing else is wrong.
  if [ -n "$link" ] && [ "$link_waitable" = 1 ] && [ -z "$files_problems" ] && [ "$live_api" = 1 ]; then
    head_sha="$(git rev-parse --verify --quiet "$head^{commit}" || true)"
    waited=0
    delay=0
    while [ -n "$head_sha" ] && {
      [ "$(ship_runs_in_flight pr-video-record.yml "$head_sha" 2>/dev/null || echo 0)" != 0 ] ||
        [ "$(ship_runs_in_flight pr-video-publish.yml "$head_sha" \
          "$(ship_video_publish_name "$PR_NUMBER" "$head_sha")" 2>/dev/null || echo 0)" != 0 ]
    }; do
      delay="$(ship_wait_next "$delay" "$waited")"
      if [ "$delay" -le 0 ]; then
        link="$link (the video for this head is still being made after $((waited / 60)) minutes; this check will be re-run when it is published)"
        break
      fi
      echo "pr-video: the video for $head_sha is being made; looking again in ${delay}s"
      ship_wait_sleep "$delay"
      waited=$((waited + delay))
      read_live || break
      # Back to a draft while it waited: nothing is due until the next ready mark.
      if [ "${PR_DRAFT:-}" = true ]; then link=''; draft=1; break; fi
      link_problem "${PR_BODY:-}"
      if [ -z "$link" ] || [ "$link_waitable" != 1 ]; then break; fi
    done
  fi
  [ -z "$link" ] || note "$link"
fi

if [ -z "$problems" ]; then
  if [ "$draft" = 1 ]; then
    echo "pr-video: draft, so no video yet"
  else
    echo "pr-video: ok"
  fi
  exit 0
fi

{
  echo "pr-video: this pull request does not follow the explainer-video rule."
  printf '%s' "$problems"
  echo
  echo "A PR explainer video is never committed to the pull request, and nobody records one by hand."
  echo "CI makes it:"
  echo "  1. open the pull request (a draft while you work) and write a ## How to see it section."
  echo "  2. mark it ready for review, or add the \`ready\` label, and CI records the walkthrough,"
  echo "     narrates it, hosts it on GitHub, and writes the link as the first line of this body."
  echo "  3. to have it remade, mark it ready again or add the \`ready\` label again."
  echo "The video is tied to the head commit: its link is pr-<n>-<sha7>.mp4, and after that commit only"
  echo "docs-only commits (*.md anywhere, or under docs/) and clean merges of main keep it. Any other"
  echo "commit needs a new video: mark the pull request ready again, or add the \`ready\` label."
  echo "That link is a bare https://github.com/$SHIP_REPO/releases/download/<shelf>/pr-<n>-<sha>.mp4 URL"
  echo "at the very top of the body, the very first thing, above the --- divider, where <shelf> is"
  echo "$SHIP_VIDEO_SHELF_PREFIX-YYYY-MM, a roll of it ($SHIP_VIDEO_SHELF_PREFIX-YYYY-MM-2 and on) or the legacy $SHIP_VIDEO_SHELF_PREFIX: an asset"
  echo "on a shelf prerelease is reachable through a documented API, costs nothing, and stays after"
  echo "the pull request merges."
  echo "A product video elsewhere in the repo is fine: this rule is only about the"
  echo "explainer video for a pull request. AGENTS.md \"PR explainer videos\"."
} >&2
exit 1

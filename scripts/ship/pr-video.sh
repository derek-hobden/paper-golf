#!/usr/bin/env bash
# The PR explainer-video check. Every pull request that is ready for review
# opens with a link to its explainer video, and that video is never a file in
# the pull request: CI records it, narrates it and hosts it as an asset on the
# long-lived `pr-videos` prerelease, then writes the link as the very first line
# of the body (AGENTS.md "PR explainer videos").
#
#   PR_ACTOR=<login> PR_DRAFT=<true|false> PR_BODY=<body> \
#     bash scripts/ship/pr-video.sh <base> <head>
#
# Fails when the diff adds a pr-explainer-* file with the extension mp4, mov,
# webm, txt or md, a root video.mp4, anything under qa-video/ or
# docs/pr-videos/; or when the first non-empty line of PR_BODY is not the
# releases/download/pr-videos/ asset link CI leaves there.
#
# A draft passes: a draft is how you work in progress, and the paid jobs that
# make the video only run once the pull request is marked ready for review.
# dependabot[bot] and renovate[bot] are exempt, because they get no video
# either. Reads only: no network, no write.
# Exit 0 when the PR passes, 1 when it does not, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,20p' "$0"; exit 0 ;; esac
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

if [ "$draft" = 0 ]; then
  # The first line of the body with something on it. A GitHub body uses CRLF, so
  # the trim takes \r with the spaces.
  first=''
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    first="$line"
    break
  done <<<"${PR_BODY:-}"

  # The bare URL CI's upload returns, on its own or in the markdown wrappers a
  # body commonly puts it in. A wrapped one is a link to the right video and not
  # worth a red check.
  url="$first"
  wrapped='^!?\[[^][]*\]\((.*)\)$'
  angled='^<(.*)>$'
  if [[ "$url" =~ $wrapped ]]; then url="${BASH_REMATCH[1]}"; fi
  if [[ "$url" =~ $angled ]]; then url="${BASH_REMATCH[1]}"; fi
  # Any repository's own asset link, so another repo running this pipeline
  # passes the same check (docs/pipeline-rollout.md).
  asset="^https://github[.]com/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+/${SHIP_VIDEO_LINK_PATH}/[A-Za-z0-9._~%-]+[.]mp4$"
  if ! [[ "$url" =~ $asset ]]; then
    if [ -z "$first" ]; then
      note "the PR body is empty: it must open with the video link"
    else
      note "the first non-empty line of the PR body is not a $SHIP_VIDEO_LINK_PATH/ asset link: $first"
    fi
  fi
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
  echo "That link is a bare https://github.com/$SHIP_REPO/$SHIP_VIDEO_LINK_PATH/pr-<n>-<sha>.mp4 URL"
  echo "at the very top of the body, the very first thing, above the --- divider: an asset on the"
  echo "$SHIP_VIDEO_RELEASE_TAG prerelease is reachable through a documented API, costs nothing, and"
  echo "stays after the pull request merges."
  echo "A product video elsewhere in the repo is fine: this rule is only about the"
  echo "explainer video for a pull request. AGENTS.md \"PR explainer videos\"."
} >&2
exit 1

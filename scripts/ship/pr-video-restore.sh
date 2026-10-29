#!/usr/bin/env bash
# Put back the explainer video link when a body edit has deleted it.
#
#   GH_TOKEN=<app token> SHIP_REPO=<owner/repo> PR=<number> PREV_BODY=<body before the edit> \
#     APP_LOGIN=<the publishing app's login, slug[bot]> bash scripts/ship/pr-video-restore.sh
#
# Run by .github/workflows/pr-video-restore.yml on a pull request's `edited`
# event when the body changed. CI writes the video link as the first line of the
# body (scripts/ship/pr-video-body.sh); an author who rewrites the body by hand
# can drop it, and the pr-video check then goes red for a video that is still on
# the shelf. This puts it back, and nothing else:
#
#   - the first non-empty line of the live body is already a video link for this
#     pull request (lib.sh ship_video_link_re, named pr-<n>-<sha7>.mp4): nothing.
#   - otherwise the link to restore is the first line of the body before the edit
#     (PREV_BODY, the event's changes.body.from) when that was one, else the
#     newest pr-<n>-*.mp4 asset by upload time on any of this repository's shelves.
#   - it is restored only when that asset is uploaded on a shelf of this
#     repository, and the pull request has a `<!-- pr-video-published -->` comment
#     written by the publishing app itself (user.type Bot and user.login
#     APP_LOGIN, never another bot that copied the marker): proof that CI
#     bought it. It is written with pr-video-body.sh, which only replaces the
#     block above the first `---`.
#
# Whether the video still stands for the head is the pr-video check's to judge,
# not this. It never makes or buys a video. The edit it makes raises another
# `edited` event, which finds the link in place and does nothing, so it cannot
# loop. A draft, a fork and a closed pull request are skipped. Reads the pull
# request, its comments and the releases through gh api; the one write is the
# body edit. Prints one line, `restore=<restored|nothing|skip> <why>`, and writes
# it to $GITHUB_STEP_SUMMARY too. Exit 0 on every decision, 1 when something
# cannot be read or the edit is refused, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,32p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: pr-video-restore.sh (see --help)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq
[ -n "${GH_TOKEN:-}" ] || { echo "GH_TOKEN is not set" >&2; exit 2; }
case "${PR:-}" in '' | *[!0-9]*) echo "PR must be a pull request number" >&2; exit 2 ;; esac
[[ "${APP_LOGIN:-}" =~ ^[a-z0-9-]+\[bot\]$ ]] || { echo "APP_LOGIN must be the publishing app's login, <slug>[bot]" >&2; exit 2; }

PUBLISHED_MARKER='<!-- pr-video-published -->'
LINK_RE="$(ship_video_link_re "$SHIP_REPO")"

decided() {
  echo "restore=$1 $2"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '### PR video link\n\n%s\n' "$2" >>"$GITHUB_STEP_SUMMARY"
  fi
  exit 0
}

# ours <url>: a link to one of this repository's shelves, named for this pull
# request. Prints "<shelf> <asset>".
ours() {
  local parts repo shelf asset
  [[ "$1" =~ $LINK_RE ]] || return 1
  parts="$(ship_video_link_parts "$1")" || return 1
  read -r repo shelf asset <<<"$parts"
  [ "$repo" = "$SHIP_REPO" ] || return 1
  [[ "$asset" =~ ^pr-${PR}-[0-9a-f]{7}[.]mp4$ ]] || return 1
  printf '%s %s\n' "$shelf" "$asset"
}

info="$(gh api "/repos/$SHIP_REPO/pulls/$PR" --jq '.')" || { echo "cannot read pull request $PR" >&2; exit 1; }
[ "$(jq -r '.state // ""' <<<"$info")" = open ] || decided skip "pull request $PR is not open"
[ "$(jq -r '.draft // false' <<<"$info")" != true ] ||
  decided skip "pull request $PR is a draft: it has no video until it is marked ready"
head_repo="$(jq -r '.head.repo.full_name // ""' <<<"$info")"
[ -z "$head_repo" ] || [ "$head_repo" = "$SHIP_REPO" ] ||
  decided skip "the head of pull request $PR is the fork $head_repo, which gets no video"

if ours "$(ship_video_body_link "$(jq -r '.body // ""' <<<"$info")")" >/dev/null; then
  decided nothing "pull request $PR already opens with its video link"
fi

# Which link: the one the edit removed, else the newest asset for this pull request.
url=''
shelf=''
asset=''
prev="$(ship_video_body_link "${PREV_BODY:-}")"
if found="$(ours "$prev")"; then
  read -r shelf asset <<<"$found"
  url="$prev"
fi

# Every shelf's assets named for this pull request and uploaded, one line each:
# "<created_at> <shelf> <asset>". Every shelf and every page, as the tidy-up reads them.
releases="$(gh api --paginate "/repos/$SHIP_REPO/releases?per_page=100" \
  --jq '.[] | "\(.id)\t\(.tag_name)"')" || {
  echo "cannot read the releases of $SHIP_REPO" >&2
  exit 1
}
assets=''
while IFS=$'\t' read -r release_id tag; do
  [ -n "$release_id" ] || continue
  ship_video_is_shelf "$tag" || continue
  rows="$(gh api --paginate "/repos/$SHIP_REPO/releases/$release_id/assets?per_page=100" --jq '
    .[] | select(.state == "uploaded") | select(.name | test("^pr-'"$PR"'-[0-9a-f]{7}[.]mp4$"))
    | "\(.created_at // "") '"$tag"' \(.name)"' </dev/null)" || {
    echo "cannot read the assets on $tag" >&2
    exit 1
  }
  [ -z "$rows" ] || assets="$assets$rows"$'\n'
done <<<"$releases"

if [ -n "$url" ]; then
  awk -v s="$shelf" -v a="$asset" '$2 == s && $3 == a { found = 1 } END { exit !found }' <<<"$assets" ||
    decided nothing "the link the edit removed, $asset on $shelf, is not an uploaded asset on a $SHIP_REPO shelf"
else
  newest="$(printf '%s' "$assets" | grep -v '^$' | LC_ALL=C sort | tail -n 1 || true)"
  [ -n "$newest" ] || decided nothing "pull request $PR has no video on any $SHIP_REPO shelf"
  read -r _ shelf asset <<<"$newest"
  url="https://github.com/$SHIP_REPO/releases/download/$shelf/$asset"
fi

# Only a video CI bought: the publish leaves the app's comment with this marker,
# and only that app's comment counts (another bot can write the marker too).
published="$(gh api --paginate "/repos/$SHIP_REPO/issues/$PR/comments?per_page=100" --jq '
  .[] | select(.user.type == "Bot" and .user.login == "'"$APP_LOGIN"'")
  | select((.body // "") | contains("'"$PUBLISHED_MARKER"'")) | .id')" || {
  echo "cannot read the comments on pull request $PR" >&2
  exit 1
}
[ -n "$published" ] ||
  decided nothing "pull request $PR has no $PUBLISHED_MARKER comment from $APP_LOGIN, so CI did not publish $asset for it"

PR="$PR" bash "$here/pr-video-body.sh" "$url" >/dev/null || exit 1
decided restored "restored the video link $asset"

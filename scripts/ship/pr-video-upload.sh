#!/usr/bin/env bash
# Put the explainer video somewhere on GitHub that costs nothing, outlives the
# pull request, and can be reached with one documented API call: an asset on one
# long-lived prerelease (AGENTS.md "PR explainer videos").
#
#   GH_TOKEN=<app token> SHIP_REPO=<owner/repo> PR=<number> HEAD_SHA=<sha> \
#     bash scripts/ship/pr-video-upload.sh <video.mp4>
#
# Prints the asset's browser_download_url on stdout and nothing else, so a
# caller can read it straight into a variable. The token goes to curl in a
# config on stdin, never in argv.
#
# The release is found by its tag and created when it is missing: a prerelease,
# never marked latest, so it never looks like a version of the game. One asset
# per head commit (`pr-<number>-<short sha>.mp4`); remaking a video for the same
# commit replaces the asset rather than collecting a second one.
#
# This used to upload to `uploads.github.com/user-attachments/assets`, GitHub's
# undocumented web-upload endpoint, because that URL plays in the browser in one
# click. It answers 404 to an App or Actions token — there is no user to attach
# the asset to — so it failed on every pull request that got as far as it
# ([PR 52](https://github.com/derek-hobden/paper-golf/pull/52), run
# 40265860037, after the video had been recorded and narrated). A release asset
# downloads rather than playing inline, which is the price of a documented
# endpoint that works.
#
# Needs `contents: write` on the token (the release and its asset). Exit 0 with
# the URL, 1 on a refusal, 2 on a usage error.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,28p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

UPLOAD_API=https://uploads.github.com
CONTENT_TYPE="video/mp4"
# One release holds every pull request's explainer. A prerelease that is never
# "latest", so the releases page still has no version of the game on it, and the
# one tag in the repository that nothing triggers on (AGENTS.md "Ship process").
RELEASE_TAG="$SHIP_VIDEO_RELEASE_TAG"
RELEASE_TITLE='PR explainer videos'
RELEASE_NOTES='CI keeps every pull request explainer video here: one asset per head commit, named pr-<number>-<short sha>.mp4. Not a release of the game — a prerelease, never marked latest, and no workflow triggers on this tag.'
# pr-video-mux.sh already caps the video far below this; a release asset may be
# much larger, so this is a guard against a runaway encode, not GitHub's limit.
MAX_BYTES=100000000

[ $# -eq 1 ] || { echo "usage: pr-video-upload.sh <video.mp4> (see --help)" >&2; exit 2; }
file="$1"
[ -f "$file" ] || { echo "::error::no video at $file" >&2; exit 2; }
ship_need gh jq curl
[ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }
[ -n "${PR:-}" ] || { echo "::error::PR is not set" >&2; exit 2; }
case "$PR" in '' | *[!0-9]*) echo "::error::PR must be a pull request number" >&2; exit 2 ;; esac
[ -n "${HEAD_SHA:-}" ] || { echo "::error::HEAD_SHA is not set" >&2; exit 2; }
case "$HEAD_SHA" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) ;;
  *) echo "::error::HEAD_SHA is not a commit sha" >&2; exit 2 ;;
esac

size="$(wc -c <"$file" | tr -d ' ')"
if [ "$size" -gt "$MAX_BYTES" ]; then
  echo "::error::the video is $size bytes; this uploads at most $MAX_BYTES" >&2
  exit 1
fi

name="pr-${PR}-${HEAD_SHA:0:7}.mp4"

# The release this asset hangs on, made once and reused for ever after.
release_id="$(gh api "/repos/$SHIP_REPO/releases/tags/$RELEASE_TAG" --jq '.id // empty' 2>/dev/null || true)"
if [ -z "$release_id" ]; then
  release_id="$(gh api --method POST "/repos/$SHIP_REPO/releases" \
    -f "tag_name=$RELEASE_TAG" -f "name=$RELEASE_TITLE" -f "body=$RELEASE_NOTES" \
    -F draft=false -F prerelease=true -f make_latest=false \
    --jq '.id // empty')" || {
    echo "::error::could not create the $RELEASE_TAG release on $SHIP_REPO: the token needs contents: write" >&2
    exit 1
  }
  echo "release=created tag=$RELEASE_TAG" >&2
else
  echo "release=found tag=$RELEASE_TAG" >&2
fi
case "$release_id" in
  '' | *[!0-9]*)
    echo "::error::the $RELEASE_TAG release has no numeric id on $SHIP_REPO" >&2
    exit 1
    ;;
esac

# Remaking the video for the same commit replaces that asset: GitHub refuses a
# second one with the same name, and two videos of one commit is not a feature.
old="$(gh api --paginate "/repos/$SHIP_REPO/releases/$release_id/assets?per_page=100" \
  --jq '.[] | select(.name == "'"$name"'") | .id' 2>/dev/null || true)"
while IFS= read -r asset_id; do
  [ -n "$asset_id" ] || continue
  if gh api --method DELETE "/repos/$SHIP_REPO/releases/assets/$asset_id" >/dev/null 2>&1; then
    echo "replaced=$name" >&2
  else
    echo "::warning::could not remove the earlier $name asset ($asset_id)" >&2
  fi
done <<<"$old"

body="$(mktemp)"
err="$(mktemp)"
trap 'rm -f "$body" "$err"' EXIT

status="$(printf 'header = "Authorization: Bearer %s"\nheader = "Accept: application/vnd.github+json"\nheader = "X-GitHub-Api-Version: 2022-11-28"\nheader = "Content-Type: %s"\nurl = "%s/repos/%s/releases/%s/assets?name=%s"\ndata-binary = "@%s"\noutput = "%s"\nwrite-out = "%%{http_code}"\n' \
  "$GH_TOKEN" "$CONTENT_TYPE" "$UPLOAD_API" "$SHIP_REPO" "$release_id" "$name" "$file" "$body" |
  curl -sS --max-time 300 -K - 2>"$err")" || status=''

case "$status" in
  200 | 201) ;;
  *)
    echo "::error::GitHub refused the release-asset upload (HTTP ${status:-none}): $(head -c 400 "$body")$(head -c 200 "$err")" >&2
    exit 1
    ;;
esac

url="$(jq -r '.browser_download_url // empty' "$body" 2>/dev/null || true)"
expected="https://github.com/$SHIP_REPO/releases/download/$RELEASE_TAG/$name"
if [ "$url" != "$expected" ]; then
  echo "::error::the upload answered $url, not the asset link $expected: $(head -c 400 "$body")" >&2
  exit 1
fi

printf '%s\n' "$url"

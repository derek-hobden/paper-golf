#!/usr/bin/env bash
# Put the explainer video somewhere on GitHub that costs nothing, outlives the
# pull request, and can be reached with one documented API call: an asset on
# this month's PR video shelf (AGENTS.md "PR explainer videos").
#
#   PR=<number> HEAD_SHA=<sha> bash scripts/ship/pr-video-upload.sh <video.mp4>
#
# The upload job of pr-video-publish.yml calls it through
# `pr-video-publish.sh --upload made`, which hands it PR and HEAD_SHA from the
# made video's made.json; GH_TOKEN (the Golf Gus app token the job mints,
# steps.gus.outputs.token) and SHIP_REPO come from that step's env.
#
# Prints the asset's browser_download_url on stdout and nothing else, so a
# caller can read it straight into a variable. The token goes to curl in a
# config on stdin, never in argv.
#
# A shelf is a prerelease, never marked latest, so it never looks like a version
# of the game. The month's is pr-videos-YYYY-MM (the UTC month now); once it
# holds SHELF_ROLL_AT assets — well before GitHub's 1,000 a release — the next
# upload rolls to pr-videos-YYYY-MM-2, then -3, and so on, and after
# MAX_SHELVES_PER_MONTH it stops and says so. A shelf is found by its tag and
# created when it is missing; a create that loses a race with another publish
# (422 already_exists) uses the shelf that publish made, looking it up at most
# RACE_TRIES times, 2s then 4s apart, and still never makes a draft or a latest. The legacy pr-videos
# shelf is never uploaded to again, and its links stay as they are. One asset
# per head commit (`pr-<number>-<short sha>.mp4`); remaking a video for the same
# commit replaces the asset on the shelf it lands on. A copy left on an older
# shelf is the tidy-up's (scripts/ship/pr-video-tidy.sh), not this script's.
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
# Needs Contents write on the token (the release and its asset): the app's
# installation has it, and the job's own GITHUB_TOKEN never calls this. Exit 0 with
# the URL, 1 on a refusal, 2 on a usage error.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,41p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

UPLOAD_API=https://uploads.github.com
CONTENT_TYPE="video/mp4"
# A shelf holding this many assets is full and the next upload rolls on.
# GitHub refuses the 1,001st asset on a release; 900 leaves room for remakes
# and for two publishes counting at the same moment.
SHELF_ROLL_AT=900
# Twenty full shelves in one month is 18,000 videos: a fault somewhere, not a
# reason to make a twenty-first.
MAX_SHELVES_PER_MONTH=20
# After a create loses a race (422 already_exists), the shelf the other publish
# made is looked up again at most this many times, RACE_PAUSE_S then twice that
# apart (2s, 4s): GitHub can take a moment to answer for a release it just made.
RACE_TRIES=3
RACE_PAUSE_S=2
RELEASE_TITLE='PR explainer videos'
RELEASE_NOTES='CI keeps pull request explainer videos here: one asset per head commit, named pr-<number>-<short sha>.mp4. Not a release of the game — a prerelease, never marked latest, and no workflow triggers on this tag.'
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
base="$(ship_video_shelf_base 2>&1)" || { echo "::error::$base" >&2; exit 2; }

size="$(wc -c <"$file" | tr -d ' ')"
if [ "$size" -gt "$MAX_BYTES" ]; then
  echo "::error::the video is $size bytes; this uploads at most $MAX_BYTES" >&2
  exit 1
fi

name="pr-${PR}-${HEAD_SHA:0:7}.mp4"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

# The shelf this asset goes on: the month's base, then its rolls, the first one
# that is missing (and is made) or holds fewer than SHELF_ROLL_AT assets. On a
# 404 gh skips --jq and prints the error body on stdout, so the lookup's stdout
# is read as the id only when it succeeded, and as the error otherwise.
roll=1
raced=0
release_id=''
tag=''
assets=''
# after_race <why>: another publish made this shelf, so look it up once more,
# pausing before every try but the first; past RACE_TRIES, fail with <why>.
after_race() {
  if [ "$raced" -ge "$RACE_TRIES" ]; then
    echo "::error::another publish made the $tag release on $SHIP_REPO, but $RACE_TRIES lookups after it did not find it: $1" >&2
    exit 1
  fi
  if [ "$raced" -gt 0 ]; then
    sleep "$((RACE_PAUSE_S << (raced - 1)))"
  fi
  raced=$((raced + 1))
}
while [ -z "$release_id" ]; do
  if [ "$roll" -gt "$MAX_SHELVES_PER_MONTH" ]; then
    echo "::error::all $MAX_SHELVES_PER_MONTH shelves of $base hold $SHELF_ROLL_AT assets or more on $SHIP_REPO; MAX_SHELVES_PER_MONTH stops here rather than make another" >&2
    exit 1
  fi
  tag="$base"
  title="$RELEASE_TITLE ${base#"$SHIP_VIDEO_SHELF_PREFIX"-}"
  if [ "$roll" -gt 1 ]; then
    tag="$base-$roll"
    title="$title-$roll"
  fi
  if found="$(gh api "/repos/$SHIP_REPO/releases/tags/$tag" --jq '.id' 2>"$scratch/err")"; then
    id="$found"
    how=found
  elif jq -e '.status == "404"' <<<"$found" >/dev/null 2>&1; then
    if created="$(gh api --method POST "/repos/$SHIP_REPO/releases" \
      -f "tag_name=$tag" -f "name=$title" -f "body=$RELEASE_NOTES" \
      -F draft=false -F prerelease=true -f make_latest=false \
      --jq '.id' 2>"$scratch/err")"; then
      id="$created"
      how=created
    elif jq -e 'any(.errors[]?; .code == "already_exists")' <<<"$created" >/dev/null 2>&1; then
      # Another publish made this shelf between the lookup and the create: look
      # it up again and use it.
      echo "release=already_exists tag=$tag" >&2
      after_race "the create still answers already_exists"
      continue
    else
      echo "::error::could not create the $tag release on $SHIP_REPO (the token needs contents: write): $(head -c 400 <<<"$created") $(head -c 200 "$scratch/err")" >&2
      exit 1
    fi
  elif [ "$raced" -gt 0 ]; then
    # A lookup after a race that fails for another reason gets the same tries.
    echo "release=lookup_failed tag=$tag" >&2
    after_race "$(head -c 400 <<<"$found") $(head -c 200 "$scratch/err")"
    continue
  else
    echo "::error::could not look up the $tag release on $SHIP_REPO: $(head -c 400 <<<"$found") $(head -c 200 "$scratch/err")" >&2
    exit 1
  fi
  case "$id" in
    '' | *[!0-9]*)
      echo "::error::the $tag release has no numeric id on $SHIP_REPO" >&2
      exit 1
      ;;
  esac
  # One line per asset, counted as lines: with --paginate gh runs --jq once per
  # page, so a length would print one number for every page.
  if ! assets="$(gh api --paginate "/repos/$SHIP_REPO/releases/$id/assets?per_page=100" \
    --jq '.[] | "\(.id)\t\(.name)"' 2>"$scratch/err")"; then
    echo "::error::could not count the assets on $tag: $(head -c 400 <<<"$assets") $(head -c 200 "$scratch/err")" >&2
    exit 1
  fi
  count="$(grep -c . <<<"$assets" || true)"
  echo "release=$how tag=$tag count=$count" >&2
  if [ "$count" -lt "$SHELF_ROLL_AT" ]; then
    release_id="$id"
  else
    roll=$((roll + 1))
    raced=0
  fi
done

# Remaking the video for the same commit replaces that asset on this shelf:
# GitHub refuses a second one with the same name, and two videos of one commit
# is not a feature.
while IFS=$'\t' read -r asset_id asset_name; do
  [ "$asset_name" = "$name" ] || continue
  if gh api --method DELETE "/repos/$SHIP_REPO/releases/assets/$asset_id" </dev/null >/dev/null 2>&1; then
    echo "replaced=$name" >&2
  else
    echo "::warning::could not remove the earlier $name asset ($asset_id)" >&2
  fi
done <<<"$assets"

body="$scratch/body"
err="$scratch/curl-err"

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
expected="https://github.com/$SHIP_REPO/releases/download/$tag/$name"
if [ "$url" != "$expected" ]; then
  echo "::error::the upload answered $url, not the asset link $expected: $(head -c 400 "$body")" >&2
  exit 1
fi

printf '%s\n' "$url"

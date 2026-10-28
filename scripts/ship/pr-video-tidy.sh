#!/usr/bin/env bash
# When a pull request merges or closes, take its superseded explainer videos off
# the PR video shelves and keep the one its body links to (AGENTS.md "PR
# explainer videos").
#
#   GH_TOKEN=<token, contents: write> SHIP_REPO=<owner/repo> PR=<number> PR_BODY=<body> \
#     HEAD_SHA=<final head sha> bash scripts/ship/pr-video-tidy.sh
#
# A pull request collects one video per passed review, `pr-<number>-<short sha>.mp4`,
# and the body's first line links the last one. This deletes the others:
#   1. The first line of PR_BODY, read as the pr-video check reads it (lib.sh),
#      must link an asset on SHIP_REPO, on a shelf lib.sh accepts, named
#      pr-<PR>-*. Anything else is doubt.
#   2. Every release is listed, every page; only the shelves are kept (so
#      pr7-evidence, or any other release, is never read further), and every
#      asset on each, every page, before anything is deleted.
#   3. The linked asset has to be on its shelf with state uploaded.
#   4. The candidates are the assets on the shelves named exactly pr-<PR>-
#      (pr-5- never matches pr-55-), less the linked asset and less
#      pr-<PR>-<final head>.mp4 on any shelf, kept so a publish still in flight
#      when the pull request closed cannot lose its file.
#   5. Each candidate is deleted (DELETE releases/assets/<id>, nothing else).
# Merged and closed-unmerged are the same: the linked video stays for good, and
# no shelf is ever deleted.
#
# In doubt it deletes nothing and says "tidy: in doubt, deleted nothing:" with
# the reason: an empty body, a first line that is not a video link, a link to
# another repository, another pull request or a release that is not a shelf, a
# linked shelf or asset that is missing or not uploaded, or more than
# MAX_DELETES candidates (that one also raises a ::warning:: annotation, so it
# shows on the run's summary). Keeping extra files is always the safe failure.
# Those exit 0 — a closed draft with no video is normal.
#
# Exit 0 when done or in doubt, 1 when listing failed (nothing deleted) or a
# delete failed (the rest still go), 2 on a usage error.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,35p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

# More than this many videos for one pull request is not a tidy-up, it is a
# fault: a pull request makes one per ready mark.
MAX_DELETES=100

[ $# -eq 0 ] || { echo "usage: pr-video-tidy.sh (see --help)" >&2; exit 2; }
[ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }
case "${PR:-}" in '' | *[!0-9]*) echo "::error::PR must be a pull request number" >&2; exit 2 ;; esac
[[ "${HEAD_SHA:-}" =~ ^[0-9a-f]{7,40}$ ]] || { echo "::error::HEAD_SHA is not a commit sha" >&2; exit 2; }
ship_need gh jq

doubt() {
  echo "tidy: in doubt, deleted nothing: $*"
  exit 0
}

link="$(ship_video_body_link "${PR_BODY:-}")"
[ -n "$link" ] || doubt "the body is empty"
parts="$(ship_video_link_parts "$link")" || doubt "the first line is not a video link on a shelf: $link"
read -r link_repo link_shelf link_name <<<"$parts"
lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
[ "$(lower "$link_repo")" = "$(lower "$SHIP_REPO")" ] ||
  doubt "the link is to another repository, $link_repo, not $SHIP_REPO"
mine="pr-$PR-"
case "$link_name" in
  "$mine"*) ;;
  *)
    other="$(sed -n 's/^pr-\([0-9][0-9]*\)-.*/pull request \1/p' <<<"$link_name")"
    doubt "the linked video $link_name is ${other:-no pull request}'s, not pull request $PR's"
    ;;
esac
final="pr-$PR-${HEAD_SHA:0:7}.mp4"

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
listed="$scratch/assets.tsv"
: >"$listed"

unlisted() {
  echo "::error::could not list $1 on $SHIP_REPO, so deleted nothing: $(head -c 300 <<<"$2") $(head -c 200 "$scratch/err")" >&2
  exit 1
}

# The whole picture first: every shelf, every asset on it, every page. One line
# per item, so --paginate running --jq once per page changes nothing.
releases="$(gh api --paginate "/repos/$SHIP_REPO/releases?per_page=100" \
  --jq '.[] | "\(.id)\t\(.tag_name)"' 2>"$scratch/err")" || unlisted "the releases" "$releases"
shelves=''
while IFS=$'\t' read -r release_id tag; do
  [ -n "$release_id" ] || continue
  ship_video_is_shelf "$tag" || continue
  shelves="$shelves $tag"
  assets="$(gh api --paginate "/repos/$SHIP_REPO/releases/$release_id/assets?per_page=100" \
    --jq '.[] | "\(.id)\t\(.name)\t\(.state)"' </dev/null 2>"$scratch/err")" || unlisted "the assets on $tag" "$assets"
  [ -z "$assets" ] || awk -v tag="$tag" '{ print tag "\t" $0 }' <<<"$assets" >>"$listed"
done <<<"$releases"

case "$shelves " in
  *" $link_shelf "*) ;;
  *) doubt "there is no $link_shelf shelf on $SHIP_REPO" ;;
esac
state="$(awk -F'\t' -v s="$link_shelf" -v n="$link_name" '$1 == s && $3 == n { print $4; exit }' "$listed")"
[ -n "$state" ] || doubt "the linked video $link_name is not on $link_shelf"
[ "$state" = uploaded ] || doubt "the linked video $link_shelf/$link_name is $state, not uploaded"

candidates="$scratch/candidates.tsv"
: >"$candidates"
while IFS=$'\t' read -r tag asset_id name _; do
  case "$name" in "$mine"*) ;; *) continue ;; esac
  if [ "$tag" = "$link_shelf" ] && [ "$name" = "$link_name" ]; then
    echo "kept $tag/$name (linked)"
  elif [ "$name" = "$final" ]; then
    echo "kept $tag/$name (final head)"
  else
    printf '%s\t%s\t%s\n' "$tag" "$asset_id" "$name" >>"$candidates"
  fi
done <"$listed"

count="$(grep -c . "$candidates" || true)"
if [ "$count" -gt "$MAX_DELETES" ]; then
  # A warning annotation, so the stop shows on the run's summary page and not
  # only in its log.
  echo "::warning::PR video tidy-up for pull request $PR stopped: $count videos to delete, more than MAX_DELETES ($MAX_DELETES); deleted nothing"
  doubt "$count videos to delete, more than $MAX_DELETES (MAX_DELETES) for one pull request"
fi

failed=0
while IFS=$'\t' read -r tag asset_id name; do
  [ -n "$asset_id" ] || continue
  if gh api --method DELETE "/repos/$SHIP_REPO/releases/assets/$asset_id" </dev/null >/dev/null 2>"$scratch/err"; then
    echo "deleted $tag/$name"
  else
    echo "::warning::could not delete $tag/$name ($asset_id): $(head -c 200 "$scratch/err")" >&2
    failed=1
  fi
done <"$candidates"
echo "tidy: pull request $PR, $count superseded video(s), $SHIP_REPO"
exit "$failed"

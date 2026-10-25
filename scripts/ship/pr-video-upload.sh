#!/usr/bin/env bash
# Put the explainer video somewhere on GitHub that opens and plays in one
# click, costs nothing, and is still there after the pull request merges: the
# user-attachments asset store, the same place a file dropped into a comment
# box lands. It is the only GitHub URL that renders as a player — a release
# asset and a file committed to a branch both download instead
# (AGENTS.md "PR explainer videos").
#
#   GH_TOKEN=<app token> SHIP_REPO=<owner/repo> \
#     bash scripts/ship/pr-video-upload.sh <video.mp4>
#
# Prints the https://github.com/user-attachments/assets/<id> URL on stdout and
# nothing else, so a caller can read it straight into a variable. The token
# goes to curl in a config on stdin, never in argv.
#
# The endpoint is the one GitHub's own web upload uses and is not in the REST
# documentation, so a refusal is reported in full rather than worked around:
# there is no second place that plays in the browser. Exit 0 with the URL, 1 on
# a refusal, 2 on a usage error.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,20p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

UPLOAD_API="https://uploads.github.com/user-attachments/assets"
CONTENT_TYPE="video/mp4"
# GitHub refuses an attachment over 100 MB; pr-video-mux.sh already caps there.
MAX_BYTES=100000000

[ $# -eq 1 ] || { echo "usage: pr-video-upload.sh <video.mp4> (see --help)" >&2; exit 2; }
file="$1"
[ -f "$file" ] || { echo "::error::no video at $file" >&2; exit 2; }
ship_need gh jq curl
[ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }

size="$(wc -c <"$file" | tr -d ' ')"
if [ "$size" -gt "$MAX_BYTES" ]; then
  echo "::error::the video is $size bytes; GitHub takes at most $MAX_BYTES" >&2
  exit 1
fi

repo_id="$(gh api "/repos/$SHIP_REPO" --jq '.id')" || {
  echo "::error::could not read the repository id for $SHIP_REPO" >&2
  exit 1
}
case "$repo_id" in '' | *[!0-9]*) echo "::error::$SHIP_REPO has no numeric id" >&2; exit 1 ;; esac

name="$(basename "$file")"
body="$(mktemp)"
err="$(mktemp)"
trap 'rm -f "$body" "$err"' EXIT

status="$(printf 'header = "Authorization: Bearer %s"\nheader = "Accept: application/json"\nheader = "Content-Type: %s"\nurl = "%s?name=%s&content_type=%s&repository_id=%s"\ndata-binary = "@%s"\noutput = "%s"\nwrite-out = "%%{http_code}"\n' \
  "$GH_TOKEN" "$CONTENT_TYPE" "$UPLOAD_API" "$name" "$CONTENT_TYPE" "$repo_id" "$file" "$body" |
  curl -sS --max-time 300 -K - 2>"$err")" || status=''

case "$status" in
  200 | 201) ;;
  *)
    echo "::error::GitHub refused the attachment upload (HTTP ${status:-none}): $(head -c 400 "$body")$(head -c 200 "$err")" >&2
    exit 1
    ;;
esac

url="$(jq -r '.url // .href // .asset_url // empty' "$body" 2>/dev/null || true)"
case "$url" in
  https://github.com/user-attachments/assets/*)
    case "$url" in
      *[!A-Za-z0-9:/._~%-]*)
        echo "::error::the attachment URL has characters a pull request body cannot carry: $url" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "::error::the upload answered no user-attachments URL: $(head -c 400 "$body")" >&2
    exit 1
    ;;
esac

printf '%s\n' "$url"

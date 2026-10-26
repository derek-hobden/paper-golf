#!/usr/bin/env bash
# Put the explainer video's link at the very top of the pull request body, and
# leave the rest of the body alone.
#
#   bash scripts/ship/pr-video-body.sh --rewrite <url> <body-file>   # print it
#   GH_TOKEN=... SHIP_REPO=... PR=51 bash scripts/ship/pr-video-body.sh <url>
#
# The body is the link, a blank line, `---`, then everything the author wrote.
# A bare URL on its own first line, nothing before it and no markdown around
# it, is what the pr-video check asks for (scripts/ship/pr-video.sh). The link
# is an asset on one of SHIP_REPO's PR video shelves (`pr-videos-YYYY-MM`, its
# `-N` rolls, or the legacy `pr-videos`; lib.sh says which names those are).
#
# Everything above the first `---` belongs to this script, and it rewrites only
# that: the template's placeholder comment on a first run, its own link on
# every run after. A body with no `---` near the top is left whole and the
# block is put in front of it, so a body written by hand is never eaten.
#
# Exit 0 when the body is written (or already right), 1 when GitHub refuses the
# edit, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,19p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

# The divider the video block ends with.
DIVIDER='---'
# A link this script could have written on an earlier run: an explainer asset
# on any of this repository's shelves. Used to tell its own block above the
# divider from the author's first paragraph, and to refuse a link from anywhere
# else.
VIDEO_LINK_RE="$(ship_video_link_re "$SHIP_REPO")"

# The author's part of a body: everything after the first `---`, but only when
# every line above that divider is one this script could have written — blank,
# the template's placeholder comment, or a video link it left on an earlier
# run. Anything else above the divider is the author's own first paragraph, and
# eating that is how a body gets quietly destroyed. Exit 3 says "not ours".
# CRLF is what a GitHub body comes back as.
rest_of() {
  awk -v divider="$DIVIDER" -v link="$VIDEO_LINK_RE" '
    { sub(/\r$/, "") }
    found { print; next }
    $0 == divider { found = 1; next }
    {
      line = $0
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", line)
      if (line == "") next
      if (line ~ /^<!--.*-->$/) next
      if (line ~ link) next
      exit 3
    }
    END { if (!found) exit 3 }
  ' "$1"
}

rewrite() {
  local url="$1" file="$2" rest
  if rest="$(rest_of "$file")"; then
    # Drop the blank lines the old divider left, so the body does not grow a
    # gap every time the video is remade.
    rest="$(printf '%s\n' "$rest" | awk 'NF || seen { seen = 1; print }')"
  else
    rest="$(sed 's/\r$//' "$file")"
  fi
  printf '%s\n\n%s\n\n%s\n' "$url" "$DIVIDER" "$rest"
}

if [ "${1:-}" = --rewrite ]; then
  [ $# -eq 3 ] || { echo "usage: pr-video-body.sh --rewrite <url> <body-file>" >&2; exit 2; }
  rewrite "$2" "$3"
  exit 0
fi

[ $# -eq 1 ] || { echo "usage: pr-video-body.sh <url> (see --help)" >&2; exit 2; }
url="$1"
if ! grep -qE -- "$VIDEO_LINK_RE" <<<"$url"; then
  echo "::error::$url is not an explainer asset link on a $SHIP_REPO video shelf" >&2
  exit 2
fi
ship_need gh jq
[ -n "${PR:-}" ] || { echo "PR is not set" >&2; exit 2; }
case "$PR" in '' | *[!0-9]*) echo "PR must be a pull request number" >&2; exit 2 ;; esac

current="$(mktemp)"
next="$(mktemp)"
payload="$(mktemp)"
trap 'rm -f "$current" "$next" "$payload"' EXIT

# Read the body as it is now, never a copy taken earlier: the author may have
# edited it while the video was being made.
gh api "/repos/$SHIP_REPO/pulls/$PR" --jq '.body // ""' >"$current" || {
  echo "::error::could not read the body of pull request $PR" >&2
  exit 1
}

rewrite "$url" "$current" >"$next"
if [ "$(sed 's/[[:space:]]*$//' "$current")" = "$(sed 's/[[:space:]]*$//' "$next")" ]; then
  echo "pr-video-body: pull request $PR already opens with this video"
  exit 0
fi

BODY="$(cat "$next")" jq -n '{body: env.BODY}' >"$payload"
if ! gh api --method PATCH "/repos/$SHIP_REPO/pulls/$PR" --input "$payload" >/dev/null; then
  echo "::error::GitHub refused the body edit on pull request $PR" >&2
  exit 1
fi
echo "pr-video-body: pull request $PR now opens with $url"

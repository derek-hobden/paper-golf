#!/usr/bin/env bash
# Join the walkthrough's recordings into one silent clip the narration can be
# muxed onto. Playwright films one .webm per size, so a phone recording and a
# desktop recording arrive at different shapes; each is scaled to fit 1280x720
# and padded, so the join never stretches a face of the app sideways.
#
#   bash scripts/ship/pr-video-join.sh <out.mp4> <in.webm> [more.webm...]
#
# The clips are pull-request data — they came from job 1, which ran the pull
# request's own code — so every secret is dropped before ffmpeg sees them.
# Exit 0 on success, 1 when ffmpeg fails, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,12p' "$0"; exit 0 ;; esac

# A crafted recording must not be able to read a key out of the media tools.
unset ANTHROPIC_API_KEY OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN

WIDTH=1280
HEIGHT=720
FPS=30

[ $# -ge 2 ] || { echo "usage: pr-video-join.sh <out.mp4> <in.webm> [more.webm...]" >&2; exit 2; }
out="$1"
shift
command -v ffmpeg >/dev/null 2>&1 || { echo "::error::ffmpeg is required" >&2; exit 1; }

inputs=()
filters=''
labels=''
n=0
for clip in "$@"; do
  [ -f "$clip" ] || { echo "::error::no clip at $clip" >&2; exit 2; }
  inputs+=(-i "$clip")
  filters="${filters}[${n}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,"
  filters="${filters}pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x23324a,"
  filters="${filters}setsar=1,fps=${FPS}[v${n}];"
  labels="${labels}[v${n}]"
  n=$((n + 1))
done
filters="${filters}${labels}concat=n=${n}:v=1:a=0[v]"

ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filters" -map '[v]' \
  -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "$out" || {
  echo "::error::ffmpeg could not join the $n clip(s)" >&2
  exit 1
}
echo "join=$n bytes=$(wc -c <"$out" | tr -d ' ')"

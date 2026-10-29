#!/usr/bin/env bash
# The review card at the end of a PR explainer video: a few seconds that show
# how the automatic code review came out, in plain words, appended to the silent
# walkthrough before the mux (review first, then the video: AGENTS.md "Paid
# jobs"). It is the last thing in the video, after the evidence, and it says
# what the numbers mean: someone new to the pull request reads it cold.
#
#   CARD_PASSED=true CARD_ROUND=2 CARD_FIXED=3 CARD_NOTES=1 \
#     bash scripts/ship/pr-video-card.sh <in.mp4> <out.mp4>
#
# The card is a tick (passed) or a cross, and fixed words with the numbers in
# them: "Automatic code review passed", "It found 3 problems first; all fixed ·
# 1 small suggestion", "Safe to merge once a person approves it". Nothing on it comes from a model or from the pull request: every
# input is a whole number or true/false, and anything else is refused. The
# narration does not read it aloud; the mux pads the voice with silence to the
# picture's length, so the card is quiet.
#
# CARD_SECONDS (4 to 6, default 5) is how long it shows; CARD_FONT a TrueType
# font, else DejaVu Sans (fc-match, then the usual paths). Every key is dropped
# before ffmpeg runs: <in.mp4> came from the pull request's own recording.
# Exit 0 on success, 1 when ffmpeg or the font fails, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac

unset ANTHROPIC_API_KEY OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN

WIDTH=1280
HEIGHT=720
FPS=30

[ $# -eq 2 ] || { echo "usage: pr-video-card.sh <in.mp4> <out.mp4> (see --help)" >&2; exit 2; }
in="$1"
out="$2"
[ -f "$in" ] || { echo "::error::no video at $in" >&2; exit 2; }
passed="${CARD_PASSED:-}"
round="${CARD_ROUND:-}"
fixed="${CARD_FIXED:-0}"
notes="${CARD_NOTES:-0}"
seconds="${CARD_SECONDS:-5}"
case "$passed" in true | false) ;; *) echo "CARD_PASSED must be true or false" >&2; exit 2 ;; esac
for n in "$round" "$fixed" "$notes" "$seconds"; do
  [[ "$n" =~ ^[0-9]{1,4}$ ]] || { echo "the card takes whole numbers only, not '$n'" >&2; exit 2; }
done
[ "$round" -ge 1 ] || { echo "CARD_ROUND starts at 1" >&2; exit 2; }
if [ "$seconds" -lt 4 ] || [ "$seconds" -gt 6 ]; then echo "CARD_SECONDS is 4 to 6" >&2; exit 2; fi
command -v ffmpeg >/dev/null 2>&1 || { echo "::error::ffmpeg is required" >&2; exit 1; }

font="${CARD_FONT:-}"
if [ -z "$font" ] && command -v fc-match >/dev/null 2>&1; then
  font="$(fc-match -f '%{file}' 'DejaVu Sans' 2>/dev/null || true)"
fi
for f in /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf /usr/share/fonts/dejavu/DejaVuSans.ttf; do
  [ -n "$font" ] && [ -f "$font" ] && break
  font="$f"
done
[ -f "$font" ] || { echo "::error::no font for the verdict card (set CARD_FONT)" >&2; exit 1; }

plural() { if [ "$1" = 1 ]; then printf '1 %s' "$2"; else printf '%s %ss' "$1" "$2"; fi; }
if [ "$passed" = true ]; then
  icon='✓'
  colour=0x3fb950
  head='Automatic code review passed'
  last='Safe to merge once a person approves it'
else
  icon='✗'
  colour=0xf85149
  head='Automatic code review did not pass'
  last='Not safe to merge yet'
fi
# What the review found, in words: no "round", no bare counts.
if [ "$fixed" = 0 ] && [ "$round" = 1 ]; then counts='No problems that block merging'
elif [ "$fixed" = 0 ]; then counts='It asked for changes first; they were made'
elif [ "$fixed" = 1 ]; then counts='It found 1 problem first; it was fixed'
else counts="It found $fixed problems first; all fixed"; fi
[ "$notes" = 0 ] || counts="$counts · $(plural "$notes" 'small suggestion')"

# The words go to drawtext through files, so no character in them is ever read
# as filter syntax.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s' "$icon" >"$work/icon"
printf '%s' "$head" >"$work/head"
printf '%s' "$counts" >"$work/counts"
printf '%s' "$last" >"$work/last"
text() { printf "drawtext=fontfile='%s':textfile='%s':fontcolor=%s:fontsize=%s:x=(w-text_w)/2:y=%s" "$font" "$1" "$2" "$3" "$4"; }
card="color=c=0x23324a:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${seconds},format=yuv420p"
card="$card,$(text "$work/icon" "$colour" 200 140)"
card="$card,$(text "$work/head" white 56 380)"
card="$card,$(text "$work/counts" 0xc9d1d9 32 470)"
card="$card,$(text "$work/last" 0xc9d1d9 40 540)"

ffmpeg -y -loglevel error -i "$in" -f lavfi -i "$card" -filter_complex \
  "[0:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x23324a,setsar=1,fps=${FPS},format=yuv420p[a];[1:v]setsar=1[b];[a][b]concat=n=2:v=1:a=0[v]" \
  -map '[v]' -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart "$out" || {
  echo "::error::ffmpeg could not add the verdict card" >&2
  exit 1
}
echo "card=$passed round=$round fixed=$fixed notes=$notes seconds=$seconds"

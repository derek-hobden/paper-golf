#!/usr/bin/env bash
# Mux a silent explainer with its narration, or copy a clip that already has audio.
#
#   bash scripts/ship/pr-video-mux.sh --probe <in.mp4>
#   bash scripts/ship/pr-video-mux.sh <in.mp4> <narration.wav> <out.mp4>
#
# --probe prints `audio` or `silent`. A clip that already has an audio stream is
# copied (`mux=kept`) and the narration is not used. A silent clip is padded — the
# last frame held — so the narration is not cut off, then encoded H.264 + AAC.
# The result has to be at most VIDEO_MAX_BYTES (default 100000000). A higher
# override is refused. The speech key and the GitHub tokens are dropped before
# ffprobe or ffmpeg runs, including on --probe: the clip is pull-request data.
# Exit 0 on success, 1 when the encode fails or stays over the cap, 2 on usage.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,13p' "$0"; exit 0 ;; esac

# A crafted clip must not be able to read a secret out of the media tools.
unset OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN VIDEO_GITHUB_TOKEN

MAX_CAP=100000000

# The cap is a ceiling. A lower override is a test; a higher one is refused.
read_cap() {
  local max="${VIDEO_MAX_BYTES:-$MAX_CAP}"
  case "$max" in
    '' | *[!0-9]*)
      echo "VIDEO_MAX_BYTES is not a number" >&2
      return 1
      ;;
  esac
  if [ "$max" -gt "$MAX_CAP" ]; then
    echo "VIDEO_MAX_BYTES is $max; the cap is $MAX_CAP" >&2
    return 1
  fi
  printf '%s' "$max"
}

probe_kind() {
  local streams
  command -v ffprobe >/dev/null 2>&1 || { echo "ffprobe is required" >&2; return 1; }
  streams="$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$1")" || return 1
  if [ -n "$streams" ]; then
    echo audio
  else
    echo silent
  fi
}

duration_of() {
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"
}

# pad is seconds of cloned last frame. -shortest is only safe once that pad
# exists: without it, -shortest would cut the picture back to the audio.
encode() {
  local crf="$1" scale="$2" pad="$3" in="$4" wav="$5" out="$6"
  local filter="" 
  if awk -v p="$pad" 'BEGIN{exit !(p > 0)}'; then
    filter="tpad=stop_mode=clone:stop_duration=${pad}"
  fi
  if [ -n "$scale" ]; then
    if [ -n "$filter" ]; then
      filter="${filter},scale=${scale}:-2"
    else
      filter="scale=${scale}:-2"
    fi
  fi
  local args=(-y -loglevel error -i "$in" -i "$wav")
  if [ -n "$filter" ]; then
    args+=(-filter_complex "[0:v]${filter}[v]" -map "[v]")
  else
    args+=(-map "0:v:0")
  fi
  args+=(-map "1:a:0" -c:v libx264 -pix_fmt yuv420p -crf "$crf" -c:a aac -b:a 128k -movflags +faststart)
  if awk -v p="$pad" 'BEGIN{exit !(p > 0)}'; then
    args+=(-shortest)
  fi
  args+=("$out")
  ffmpeg "${args[@]}"
}

if [ "${1:-}" = --probe ]; then
  read_cap >/dev/null || exit 1
  [ $# -eq 2 ] || { echo "usage: pr-video-mux.sh --probe <in.mp4>" >&2; exit 2; }
  probe_kind "$2"
  exit 0
fi

[ $# -eq 3 ] || { echo "usage: pr-video-mux.sh <in.mp4> <narration.wav> <out.mp4>" >&2; exit 2; }
in="$1"
wav="$2"
out="$3"
max="$(read_cap)" || exit 1
command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required" >&2; exit 1; }
kind="$(probe_kind "$in")" || exit 1
if [ "$kind" = audio ]; then
  cp "$in" "$out"
  size="$(wc -c <"$out" | tr -d ' ')"
  if [ "$size" -gt "$max" ]; then
    echo "mux=kept is $size bytes, over $max" >&2
    exit 1
  fi
  echo "mux=kept"
  exit 0
fi

ad="$(duration_of "$wav")" || exit 1
vd="$(duration_of "$in")" || exit 1
if [ -z "$ad" ] || [ -z "$vd" ]; then
  echo "no duration for the clip or the narration" >&2
  exit 1
fi
pad="$(awk -v a="$ad" -v v="$vd" 'BEGIN {
  d = a - v
  if (d < 0) d = 0
  if (d > 0) d += 0.05
  printf "%.3f", d
}')"

# Crf and width, loudest first. Stop at the first file that fits the cap.
set -- 23 '' 28 1280 32 960 36 640
while [ $# -ge 2 ]; do
  crf="$1"
  scale="$2"
  shift 2
  rm -f "$out"
  if ! encode "$crf" "$scale" "$pad" "$in" "$wav" "$out"; then
    echo "mux rung crf=$crf failed" >&2
    continue
  fi
  size="$(wc -c <"$out" | tr -d ' ')"
  if [ "$size" -le "$max" ]; then
    echo "mux=encoded crf=$crf bytes=$size"
    exit 0
  fi
  echo "mux rung crf=$crf bytes=$size over $max" >&2
done
echo "mux still over $max" >&2
exit 1

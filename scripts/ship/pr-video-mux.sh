#!/usr/bin/env bash
# Mux a silent explainer with its narration, or copy a clip that already has audio.
#
#   bash scripts/ship/pr-video-mux.sh --probe <in.mp4>
#   bash scripts/ship/pr-video-mux.sh <in.mp4> <narration.wav> <out.mp4>
#
# --probe prints `audio` or `silent`. A clip that already has an audio stream is
# copied (`mux=kept`) and the narration is not used. A silent clip is padded — the
# last frame held — so the narration is not cut off, and the narration is padded
# with silence to the picture's length, so the audio stream always runs to the end
# of the video (run 40283786694 left 17 s of audio over 60 s). The video ends
# TAIL_SECONDS after the narration's last word: where the speech ends is the end
# of the last stretch that is not silence in the raw narration (ffmpeg
# silencedetect at the audio gate's SILENCE_NOISE_DB, for SPEECH_END_MIN_S), so
# the voice's own trailing quiet is dropped too. A recording that runs on past
# that is cut there, and a shorter one holds its last frame until then (Gus on
# pr-98-8de94ab.mp4: 2 s of silence after the last word; the audio gate fails
# any silence over 0.8 s). Whether the speech itself is long enough is for
# pr-video-audio-gate.sh. Encoded H.264 + AAC. The narration first goes through
# AUDIO_CHAIN: a 40 Hz high-pass (no DC step or thump), a 50 ms fade-in (no click
# before the first word) and a limiter at about -3.6 dBFS: the AAC encode adds
# up to about 2 dB of inter-sample peak, and real Kore narration driven 6 dB
# over full scale came out at -1.7 dBFS true peak or under, inside the gate's
# -1 dBFS ceiling (issue 80: PR 82's video opened on a click and peaked at full
# scale).
# The result has to be at most VIDEO_MAX_BYTES (default 100000000). A higher
# override is refused. The speech key and the GitHub tokens are dropped before
# ffprobe or ffmpeg runs, including on --probe: the clip is pull-request data.
# The result is uploaded to GitHub's attachment store and linked from the top of
# the pull request body, never committed to it (AGENTS.md "PR explainer videos").
# Exit 0 on success, 1 when the encode fails or stays over the cap, 2 on usage.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac

# A crafted clip must not be able to read a secret out of the media tools.
unset OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN VIDEO_GITHUB_TOKEN

MAX_CAP=100000000
# How long the video runs on after the narration's last word.
TAIL_SECONDS=0.5
# What the narration goes through before it is padded to the picture's length.
AUDIO_CHAIN="highpass=f=40,afade=t=in:st=0:d=0.05,alimiter=limit=0.66:level=false"
# Silence as pr-video-audio-gate.sh measures it (SILENCE_NOISE_DB), and the
# shortest quiet at the end of the narration that counts as its tail.
SILENCE_NOISE_DB=-45
SPEECH_END_MIN_S=0.3

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

# speech_end <narration.wav> <its duration>: where the last word ends. A
# silence that runs to the end of the file (silencedetect closes it at the end
# of the input, or leaves it open) is the tail; with none, the speech runs to
# the end of the file.
speech_end() {
  local log
  log="$(ffmpeg -hide_banner -nostats -i "$1" -af "silencedetect=noise=${SILENCE_NOISE_DB}dB:d=${SPEECH_END_MIN_S}" \
    -f null /dev/null 2>&1 || true)"
  printf '%s\n' "$log" | awk -v d="$2" '
    /silence_start:/ { s = $0; sub(/.*silence_start: */, "", s); sub(/ .*/, "", s); open = 1; last = s + 0 }
    /silence_end:/ { e = $0; sub(/.*silence_end: */, "", e); sub(/ .*/, "", e); open = 0; ended = e + 0 }
    END {
      tail = open || (ended > 0 && d - ended < 0.1)
      if (tail && last > 0) printf "%.3f", last; else printf "%.3f", d
    }'
}

# pad is seconds of cloned last frame; length is the finished video's. The
# narration is padded with silence without end, and both streams are cut at
# length, so the audio lasts exactly as long as the picture.
encode() {
  local crf="$1" scale="$2" pad="$3" length="$4" in="$5" wav="$6" out="$7"
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
  local graph="[1:a]${AUDIO_CHAIN},apad[a]"
  local video_map="0:v:0"
  if [ -n "$filter" ]; then
    graph="[0:v]${filter}[v];${graph}"
    video_map="[v]"
  fi
  ffmpeg -y -loglevel error -i "$in" -i "$wav" -filter_complex "$graph" -map "$video_map" -map "[a]" \
    -c:v libx264 -pix_fmt yuv420p -crf "$crf" -c:a aac -b:a 128k -movflags +faststart -t "$length" "$out"
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
# The video ends TAIL_SECONDS after the last word: a recording that runs on is
# cut there, and one that is shorter holds its last frame until then.
said="$(speech_end "$wav" "$ad")"
length="$(awk -v s="$said" -v t="$TAIL_SECONDS" 'BEGIN { printf "%.3f", s + t }')"
pad="$(awk -v l="$length" -v v="$vd" 'BEGIN { d = l - v; if (d < 0) d = 0; else d += 0.05; printf "%.3f", d }')"

# Crf and width, loudest first. Stop at the first file that fits the cap.
set -- 23 '' 28 1280 32 960 36 640
while [ $# -ge 2 ]; do
  crf="$1"
  scale="$2"
  shift 2
  rm -f "$out"
  if ! encode "$crf" "$scale" "$pad" "$length" "$in" "$wav" "$out"; then
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

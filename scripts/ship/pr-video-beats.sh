#!/usr/bin/env bash
# Beat mode (issue 80): put the picture in step with the voice by construction.
# A walkthrough that leaves beats.json says when each of its scenes starts; the
# narration (pr-video-script.sh with BEAT_SECONDS) is one paragraph per scene.
# This voices each paragraph on its own (pr-video-narrate.sh), then holds each
# scene for exactly its paragraph: the scene's footage from its start, cut where
# its paragraph and a short gap end, or its last frame held until they do. The
# last scene runs on TAIL_SECONDS after its paragraph, as the mux would leave it.
# So every scene's picture starts on the word its paragraph starts with, however
# long the model's words or the voice's pace run. A scene's footage stops
# GUARD_SECONDS short of the next start, so the frame a long paragraph holds is
# always its own scene's: the recording begins a moment after the page's clock,
# so footage taken right up to the next start ends on the next scene's first
# frame, and holding that put the next picture up early (pr-73-ebc7387.mp4).
# Each paragraph's voice is trimmed to LEAD_SECONDS of quiet before its first
# word, so a scene's picture comes up on that word, not on a pause the voice
# happened to open with.
#
#   OPENROUTER_API_KEY=... bash scripts/ship/pr-video-beats.sh \
#     <clip.mp4> "<start1> <start2> ... <startN>" <narration.txt> <out.mp4> <out.wav>
#
# The starts are seconds into <clip.mp4>, the first under 2 and each after the
# one before, all inside the clip; the narration has exactly N paragraphs
# (blank lines between). <out.wav> is the voice, each paragraph padded with
# silence to its scene; <out.mp4> is the silent picture, the same length.
# <out.wav>.beats says, one line per scene, where its picture and its voice
# start (always the same second) and how long it is held. The clip is pull
# request data: ffmpeg and ffprobe run with every key unset.
#
# Exit 0 on success, 1 when a voice or an encode fails, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The pause after each paragraph before the next scene, and the run-on after the last.
GAP_SECONDS=0.4
# How far short of the next scene's start a scene's footage stops: more than the
# recording's lag behind the page's clock. Never more than half the scene.
GUARD_SECONDS=0.5
# Quiet kept before each paragraph's first word, and the level below which it is quiet.
LEAD_SECONDS=0.05
QUIET_DB=-45
TAIL_SECONDS=2
FPS=30

[ $# -eq 5 ] || { echo "usage: pr-video-beats.sh <clip.mp4> \"<starts>\" <narration.txt> <out.mp4> <out.wav> (see --help)" >&2; exit 2; }
clip="$1" starts="$2" text="$3" out="$4" wav="$5"
[ -f "$clip" ] || { echo "::error::no clip at $clip" >&2; exit 2; }
[ -f "$text" ] || { echo "::error::no narration at $text" >&2; exit 2; }
for tool in ffmpeg ffprobe awk; do
  command -v "$tool" >/dev/null 2>&1 || { echo "::error::$tool is required" >&2; exit 1; }
done
media() { env -u ANTHROPIC_API_KEY -u OPENROUTER_API_KEY -u GH_TOKEN -u GITHUB_TOKEN "$@"; }
seconds_of() { media ffprobe -v error -show_entries format=duration -of csv=p=0 "$1"; }

read -r -a start <<<"$starts"
n="${#start[@]}"
length="$(seconds_of "$clip")"
awk -v l="$length" -v s="$starts" 'BEGIN {
  k = split(s, a, " ")
  if (k < 2) exit 1
  for (i = 1; i <= k; i++) {
    if (a[i] !~ /^[0-9]+(\.[0-9]+)?$/) exit 1
    if (i == 1 && a[i] >= 2) exit 1
    if (i > 1 && a[i] <= a[i - 1]) exit 1
    if (a[i] >= l) exit 1
  }
}' || { echo "::error::the beat starts '$starts' are not increasing seconds inside the ${length}s clip" >&2; exit 2; }
found="$(awk 'BEGIN { RS = "" } END { print NR }' "$text")"
[ "$found" = "$n" ] || { echo "::error::the narration has $found paragraphs for $n scenes" >&2; exit 2; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
awk -v dir="$work" 'BEGIN { RS = "" } { f = sprintf("%s/p%02d.txt", dir, NR); print > f; close(f) }' "$text"

vfilter='' afilter='' vlabels='' alabels='' inputs=(-i "$clip") report='' at=0
for ((i = 0; i < n; i++)); do
  p="$(printf '%s/p%02d' "$work" $((i + 1)))"
  bash "$here/pr-video-narrate.sh" "$p.txt" "$p.wav" >/dev/null || {
    echo "::error::the voice failed on the narration's paragraph $((i + 1))" >&2
    exit 1
  }
  media ffmpeg -v error -y -i "$p.wav" \
    -af "silenceremove=start_periods=1:start_duration=0:start_threshold=${QUIET_DB}dB:start_silence=${LEAD_SECONDS}" \
    "$p.lead.wav" || { echo "::error::could not trim the quiet before paragraph $((i + 1))" >&2; exit 1; }
  mv "$p.lead.wav" "$p.wav"
  voice="$(seconds_of "$p.wav")"
  # A voice with no word above the quiet level trims to nothing: no scene is held for that.
  awk -v v="${voice:-0}" 'BEGIN { exit !(v + 0 > 0.1) }' || {
    echo "::error::the voice for the narration's paragraph $((i + 1)) is silent (nothing above ${QUIET_DB} dB)" >&2
    exit 1
  }
  extra="$GAP_SECONDS"
  [ $((i + 1)) -lt "$n" ] || extra="$TAIL_SECONDS"
  if [ $((i + 1)) -lt "$n" ]; then natural="$(awk -v a="${start[$i]}" -v b="${start[$((i + 1))]}" 'BEGIN { print b - a }')"
  else natural="$(awk -v a="${start[$i]}" -v l="$length" 'BEGIN { print l - a }')"; fi
  # Held for its paragraph and the gap: footage up to that, then its last frame,
  # which is never from within GUARD_SECONDS of the next scene's start.
  read -r hold take still <<<"$(awk -v v="$voice" -v e="$extra" -v nat="$natural" -v g="$GUARD_SECONDS" 'BEGIN {
    h = v + e; own = (nat - g > nat / 2) ? nat - g : nat / 2
    t = (own < h) ? own : h; printf "%.3f %.3f %.3f", h, t, h - t }')"
  vfilter="${vfilter}[0:v]trim=start=${start[$i]}:duration=${take},setpts=PTS-STARTPTS,fps=${FPS},tpad=stop_mode=clone:stop_duration=${still}[v$i];"
  inputs+=(-i "$p.wav")
  afilter="${afilter}[$((i + 1)):a]aresample=24000,apad=whole_dur=${hold},atrim=0:${hold}[a$i];"
  vlabels="${vlabels}[v$i]"
  alabels="${alabels}[a$i]"
  report="${report}$(printf 'scene %d: picture %.2fs voice %.2fs held %.2fs (voice %.2fs, footage %.2fs)' \
    $((i + 1)) "$at" "$at" "$hold" "$voice" "$take")
"
  at="$(awk -v a="$at" -v h="$hold" 'BEGIN { printf "%.3f", a + h }')"
done
media ffmpeg -v error -y "${inputs[@]}" -filter_complex \
  "${vfilter}${vlabels}concat=n=${n}:v=1:a=0[v];${afilter}${alabels}concat=n=${n}:v=0:a=1[a]" \
  -map '[v]' -an -c:v libx264 -pix_fmt yuv420p -r "$FPS" "$out" \
  -map '[a]' -vn -ac 1 -ar 24000 "$wav" || { echo "::error::ffmpeg could not put the scenes in step with the voice" >&2; exit 1; }
printf '%s' "$report" >"$wav.beats"
printf '%s' "$report"
echo "beats: $n scenes in step with the voice, ${at}s"

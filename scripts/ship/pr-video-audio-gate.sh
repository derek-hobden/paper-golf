#!/usr/bin/env bash
# Listen to a finished explainer video before it is published, and say so when
# the narration is missing, short, silent, too quiet or too loud, or says
# something other than its script (PR 54's video: 25 s of voice over 60 s of
# picture, garbled where it gave out, and only "an audio stream exists" was
# checked). In the publish workflow it only advises (--advisory).
#
#   bash scripts/ship/pr-video-audio-gate.sh <video.mp4> <narration.txt> <narration.wav> <report.txt>
#   bash scripts/ship/pr-video-audio-gate.sh --advisory <video.mp4> <narration.txt> <narration.wav> <report.txt>
#
# <narration.wav> is the voice as the speech endpoint gave it, before the mux
# padded it to the picture: the span the speech checks are measured over. The
# finished video itself may hold no silence over MAX_SILENCE_S anywhere.
#
# It fails, printing every failing reason in plain words, when:
#   - there is no audio stream, or the audio and video lengths differ by more
#     than MAX_DURATION_DIFF_S;
#   - speech in the video (whatever is not silence) covers less than
#     MIN_SPEECH_RATIO of the raw narration's length;
#   - silence (ffmpeg silencedetect, SILENCE_NOISE_DB for SILENCE_MIN_S) from
#     the start to the end of the raw narration is more than MAX_SILENCE_RATIO
#     of it, not counting a tail of up to TAIL_ALLOWANCE_S at its end, or any
#     silent gap in it before that tail is over MAX_GAP_S;
#   - anywhere in the finished video, its start and its end included, there is
#     a silence longer than MAX_SILENCE_S (pr-98-8de94ab.mp4 ended on 3 s of
#     nothing; the mux and the beats now stop 0.5 s after the last word), quiet
#     being PAUSE_BELOW_SPEECH_DB under the speech's own loudness, or Whisper
#     heard a pause longer than MAX_SILENCE_S between two words: a level meter
#     at -45 dB heard no silence in pr-99-58eefae.mp4, where the voice's breath
#     and trailing tail left 1 to 2 s of dead air at every slide change;
#   - the integrated loudness (ffmpeg ebur128) is outside MIN_LUFS to MAX_LUFS,
#     or its true peak is over MAX_TRUE_PEAK_DB (issue 80: full scale clips);
#   - Whisper (faster-whisper, WHISPER_MODEL at WHISPER_REVISION, on the CPU) heard
#     words that, against the script, have a word error rate over MAX_WER, cover
#     less than MIN_COVERAGE of it in order, or less than MIN_LAST_FIFTH of the
#     words in its last fifth. These are what catch a voice that gives out
#     early (PR 54).
#
# Only ffmpeg and local Python: no key, no network but the pinned model's
# download, which the publish workflow caches, nothing that costs money; that
# workflow runs it in a job of its own that holds no secret. The report goes
# to <report.txt>, to stdout and to $GITHUB_STEP_SUMMARY; what Whisper heard
# is kept next to it as transcript.txt. A test may hand in the transcript as
# the file $AUDIO_GATE_TRANSCRIPT instead of running Whisper; the report says
# so, and the publish workflow's gate step unsets it. Exit 0 pass, 1 fail,
# 2 usage; with --advisory (the publish workflow: the video is best effort and
# never holds a merge, Derek, 1 Nov 2026) a fail, or a gate that cannot run, is
# a warning (lib.sh ship_video_warning) and the exit is 0.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac

# The thresholds, named once. Speech and silence ratios are of the raw
# narration's length.
MAX_DURATION_DIFF_S=1.5
MIN_SPEECH_RATIO=0.60
SILENCE_NOISE_DB=-45
SILENCE_MIN_S=1
MAX_SILENCE_RATIO=0.30
TAIL_ALLOWANCE_S=3
MAX_GAP_S=3
# No silence anywhere in the finished video longer than this, its end included.
MAX_SILENCE_S=0.8
# Quiet, for that check, is this far below the speech's own integrated loudness (never below
# SILENCE_NOISE_DB): breath and a trailing tail are dead air too (pr-99-58eefae.mp4).
PAUSE_BELOW_SPEECH_DB=20
MIN_LUFS=-24
MAX_LUFS=-10
MAX_TRUE_PEAK_DB=-1
MAX_WER=0.35
MIN_COVERAGE=0.80
MIN_LAST_FIFTH=0.60
# Whisper tiny, pinned to one commit of its Hugging Face repository, so the
# listener is the same model on every run (the package is hash-pinned in
# audio-gate-requirements.txt).
WHISPER_MODEL=Systran/faster-whisper-tiny
WHISPER_REVISION=d90ca5fe260221311c53c58e660288d3deb8d356
WHISPER_COMPUTE=int8

# The video is pull-request data; the media tools never see a secret.
unset ANTHROPIC_API_KEY OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN VIDEO_GITHUB_TOKEN

advisory=0
if [ "${1:-}" = --advisory ]; then
  advisory=1
  shift
fi
[ $# -eq 4 ] || {
  echo "usage: pr-video-audio-gate.sh [--advisory] <video.mp4> <narration.txt> <narration.wav> <report.txt>" >&2
  exit 2
}
video="$1"
script="$2"
voice="$3"
report="$4"
[ -f "$video" ] || { echo "::error::no video at $video" >&2; exit 2; }
[ -f "$script" ] || { echo "::error::no narration script at $script" >&2; exit 2; }
[ -f "$voice" ] || { echo "::error::no raw narration audio at $voice" >&2; exit 2; }
for tool in ffmpeg ffprobe python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "::error::$tool is required for the audio gate" >&2; exit 2; }
done
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
transcript="$(dirname "$report")/transcript.txt"
# Nothing an earlier run left may be read as this run's verdict: a gate that
# dies before it writes leaves no report at all, never a stale PASS.
rm -f "$report" "$transcript"

status=0
python3 -I "$here/pr-video-audio-gate.py" "$video" "$script" "$voice" "$report" \
  "$transcript" "${AUDIO_GATE_TRANSCRIPT:-}" \
  "MAX_DURATION_DIFF_S=$MAX_DURATION_DIFF_S" "MIN_SPEECH_RATIO=$MIN_SPEECH_RATIO" \
  "SILENCE_NOISE_DB=$SILENCE_NOISE_DB" "SILENCE_MIN_S=$SILENCE_MIN_S" \
  "MAX_SILENCE_RATIO=$MAX_SILENCE_RATIO" "TAIL_ALLOWANCE_S=$TAIL_ALLOWANCE_S" "MAX_GAP_S=$MAX_GAP_S" "MAX_SILENCE_S=$MAX_SILENCE_S" "PAUSE_BELOW_SPEECH_DB=$PAUSE_BELOW_SPEECH_DB" \
  "MIN_LUFS=$MIN_LUFS" "MAX_LUFS=$MAX_LUFS" "MAX_TRUE_PEAK_DB=$MAX_TRUE_PEAK_DB" "MAX_WER=$MAX_WER" "MIN_COVERAGE=$MIN_COVERAGE" \
  "MIN_LAST_FIFTH=$MIN_LAST_FIFTH" "WHISPER_MODEL=$WHISPER_MODEL" \
  "WHISPER_REVISION=$WHISPER_REVISION" "WHISPER_COMPUTE=$WHISPER_COMPUTE" ||
  status=$?
if [ ! -f "$report" ]; then
  if [ "$advisory" = 1 ]; then
    ship_video_warning "the audio check could not run (status $status, no report), and the video is published anyway"
    exit 0
  fi
  echo "::error::the audio gate wrote no report" >&2
  exit 1
fi
cat "$report"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### Audio gate\n\n%s\n' "$(sed 's/^/    /' "$report")" >>"$GITHUB_STEP_SUMMARY"
fi
reasons="$(sed -n 's/^reason: //p' "$report" | paste -sd ';' - | sed 's/;/; /g')"
case "$status" in
  0) exit 0 ;;
  1)
    if [ "$advisory" = 1 ]; then
      ship_video_warning "the audio check flagged this video ($reasons), and it is published anyway"
      exit 0
    fi
    echo "::error::the explainer's audio failed the gate: $reasons" >&2
    exit 1
    ;;
  *)
    if [ "$advisory" = 1 ]; then
      ship_video_warning "the audio check could not run (status $status), and the video is published anyway"
      exit 0
    fi
    echo "::error::the audio gate could not run (status $status)" >&2
    exit 1
    ;;
esac

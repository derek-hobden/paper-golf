#!/usr/bin/env bash
# The narration for a pull request's explainer video. One voice, one model, no choice:
# OpenRouter's text-to-speech endpoint with google/gemini-3.8-flash-lite-tts and the voice
# Kore (Derek's rule, CLAUDE.md "PR explainer videos"). A narration recorded with anything
# else is the wrong video, so nothing here is configurable and every failure is loud.
#
#   bash scripts/ship/pr-video-narrate.sh <text-file> <out.wav>
#   bash scripts/ship/pr-video-narrate.sh --print-request <text-file>   # the body, no call
#
# $OPENROUTER_API_KEY must be set; the key goes to curl in a config on stdin, never in argv.
# Gemini TTS answers raw PCM only (s16le, 24 kHz, mono), which ffmpeg wraps as the wav.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,12p' "$0"; exit 0 ;; esac

# The voice and the model. Not overridable: that is the point of this script.
TTS_MODEL="google/gemini-3.8-flash-lite-tts"
TTS_VOICE="Kore"
TTS_FORMAT="pcm"
TTS_RATE=24000
# Only the host is overridable, so the ship tests can answer without a network.
API="${OPENROUTER_API_BASE:-https://openrouter.ai/api/v1}/audio/speech"

print_only=0
if [ "${1:-}" = --print-request ]; then
  print_only=1
  shift
fi

[ $# -ge 1 ] || { echo "usage: pr-video-narrate.sh <text-file> <out.wav>" >&2; exit 2; }
text_file="$1"
[ -f "$text_file" ] || { echo "::error::no narration file at $text_file" >&2; exit 2; }
if [ "$print_only" = 0 ]; then
  [ $# -eq 2 ] || { echo "usage: pr-video-narrate.sh <text-file> <out.wav>" >&2; exit 2; }
fi
out="${2:-}"

command -v jq >/dev/null 2>&1 || { echo "::error::jq is required" >&2; exit 2; }

request="$(jq -n --rawfile input "$text_file" \
  --arg model "$TTS_MODEL" --arg voice "$TTS_VOICE" --arg format "$TTS_FORMAT" \
  '{model: $model, voice: $voice, input: $input, response_format: $format}')" ||
  { echo "::error::could not build the request" >&2; exit 2; }

if [ "$print_only" = 1 ]; then
  printf '%s\n' "$request"
  exit 0
fi

# The key is required, and its absence is a hard failure: a missing key must never quietly
# become a narration in some other voice.
[ -n "${OPENROUTER_API_KEY:-}" ] || {
  echo "::error::OPENROUTER_API_KEY is not set, and the explainer narration may only be recorded with $TTS_MODEL voice $TTS_VOICE" >&2
  exit 1
}
pcm="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$pcm" "$body"' EXIT

status="$(printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\nurl = "%s"\ndata = %s\noutput = "%s"\nwrite-out = "%%{http_code}"\n' \
  "$OPENROUTER_API_KEY" "$API" "$(jq -Rs . <<<"$request")" "$pcm" |
  curl -sS --max-time 120 -K - 2>"$body")" || status=''

if [ "$status" != 200 ]; then
  echo "::error::$TTS_MODEL (voice $TTS_VOICE) answered ${status:-no status}: $(head -c 400 "$pcm" 2>/dev/null)$(head -c 200 "$body")" >&2
  exit 1
fi
# An error body is JSON, not audio; PCM of a sentence is tens of kilobytes.
# `tr -d '\0'` because PCM often starts with a null byte, which a substitution would warn about.
case "$(head -c 1 "$pcm" | tr -d '\0')" in
  '{' | '[') echo "::error::the speech endpoint answered JSON, not audio: $(head -c 400 "$pcm")" >&2; exit 1 ;;
esac
size="$(wc -c <"$pcm")"
[ "$size" -ge 2000 ] || { echo "::error::only $size bytes of audio came back from $TTS_MODEL" >&2; exit 1; }

# Last, so a refusal above is reported on a machine without ffmpeg too.
command -v ffmpeg >/dev/null 2>&1 || { echo "::error::ffmpeg is required to wrap the PCM" >&2; exit 2; }
ffmpeg -y -loglevel error -f s16le -ar "$TTS_RATE" -ac 1 -i "$pcm" "$out" ||
  { echo "::error::ffmpeg could not wrap the PCM as $out" >&2; exit 1; }
echo "narrated $(basename "$out") with $TTS_MODEL voice $TTS_VOICE ($size bytes of PCM)"

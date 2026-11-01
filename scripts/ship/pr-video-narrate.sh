#!/usr/bin/env bash
# The narration for a pull request's explainer video. One voice, one model, no choice:
# OpenRouter's text-to-speech endpoint with google/gemini-3.8-flash-lite-tts and the voice
# Kore (Derek's rule, AGENTS.md "PR explainer videos"). A narration recorded with anything
# else is the wrong video, so nothing here is configurable and every failure is loud.
#
#   bash scripts/ship/pr-video-narrate.sh <text-file> <out.wav>
#
# The endpoint is fixed too: https://openrouter.ai/api/v1/audio/speech.
# $OPENROUTER_API_KEY must be set; the key goes to curl in a config on stdin, never in argv.
# Gemini TTS answers raw PCM only (s16le, 24 kHz, mono), which ffmpeg wraps as the wav.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,11p' "$0"; exit 0 ;; esac

# The endpoint, the model and the voice. Not overridable: that is the point of this script.
API="https://openrouter.ai/api/v1/audio/speech"
TTS_MODEL="google/gemini-3.8-flash-lite-tts"
TTS_VOICE="Kore"
TTS_FORMAT="pcm"
TTS_RATE=24000
# Every pause the voice leaves, its end included, is cut to PAUSE_S at most, and its start to
# LEAD_S; quiet is below QUIET_DB (RMS over 30 ms). The voice's own breaths and trailing tails
# between sentences and scenes were heard as 1 to 2 s of dead air while a -45 dB meter heard none
# (pr-99-58eefae.mp4); capped, its longest pause between two words fell from 0.94 s to 0.6 s.
QUIET_DB=-40
PAUSE_S=0.25
LEAD_S=0.05
CAP_PAUSES="silenceremove=start_periods=1:start_threshold=${QUIET_DB}dB:start_silence=${LEAD_S}:stop_periods=-1:stop_threshold=${QUIET_DB}dB:stop_silence=${PAUSE_S}:detection=rms:window=0.03"

[ $# -eq 2 ] || { echo "usage: pr-video-narrate.sh <text-file> <out.wav>" >&2; exit 2; }
text_file="$1"
out="$2"
[ -f "$text_file" ] || { echo "::error::no narration file at $text_file" >&2; exit 2; }

command -v jq >/dev/null 2>&1 || { echo "::error::jq is required" >&2; exit 2; }

# How the voice is to say the brand names it reads wrong (Kore said "Sonnet" as "so-NAY"
# in pr-98-abd872c.mp4, at 0:15 and 0:46). Each name is respelled the way it sounds, whole
# words only and case as written, in the text sent to the voice and nowhere else: the
# narration file keeps the real words, which the audio gate's transcript is checked against.
# One "Name=Respelling" per line; add a name here when the voice says one wrong.
SAY_AS='Sonnet=Sonnit
Opus=Oh-pus
Claude=Clawd
Vercel=Ver-sell
Supabase=Soopa-base'
said="$(mktemp)"
trap 'rm -f "$said"' EXIT
# perl, not sed: \b is the same word boundary in every perl, while BSD sed (macOS) has no \b.
# The map reaches perl as data on its environment, never as code, so "Claude's" becomes
# "Clawd's" and "Opuses" or "Sonnets" stay as they are unless listed.
command -v perl >/dev/null 2>&1 || { echo "::error::perl is required for the pronunciation map" >&2; exit 2; }
SAY_AS="$SAY_AS" perl -pe '
  BEGIN { for (split /\n/, $ENV{SAY_AS}) { my ($w, $s) = split /=/, $_, 2; push @say, [qr/\b\Q$w\E\b/, $s] } }
  for my $p (@say) { s/$p->[0]/$p->[1]/g }
' "$text_file" >"$said" || { echo "::error::could not apply the pronunciation map" >&2; exit 2; }

request="$(jq -n --rawfile input "$said" \
  --arg model "$TTS_MODEL" --arg voice "$TTS_VOICE" --arg format "$TTS_FORMAT" \
  '{model: $model, voice: $voice, input: $input, response_format: $format}')" ||
  { echo "::error::could not build the request" >&2; exit 2; }

# The key is required, and its absence is a hard failure: a missing key must never quietly
# become a narration in some other voice.
[ -n "${OPENROUTER_API_KEY:-}" ] || {
  echo "::error::OPENROUTER_API_KEY is not set, and the explainer narration may only be recorded with $TTS_MODEL voice $TTS_VOICE" >&2
  exit 1
}
pcm="$(mktemp)"
body="$(mktemp)"
trap 'rm -f "$pcm" "$body" "$said"' EXIT

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
# The key has already gone out in the curl config. The wrapper does not need it,
# and neither does it need a GitHub token: the bytes it reads are the reply.
unset OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN VIDEO_GITHUB_TOKEN
command -v ffmpeg >/dev/null 2>&1 || { echo "::error::ffmpeg is required to wrap the PCM" >&2; exit 2; }
ffmpeg -y -loglevel error -f s16le -ar "$TTS_RATE" -ac 1 -i "$pcm" -af "$CAP_PAUSES" "$out" ||
  { echo "::error::ffmpeg could not wrap the PCM as $out" >&2; exit 1; }
echo "narrated $(basename "$out") with $TTS_MODEL voice $TTS_VOICE ($size bytes of PCM)"

#!/usr/bin/env bash
# The words the explainer video is narrated with. Claude writes them from the
# pull request's title, its `## How to see it` steps and its diff stat — the
# three things that say what changed and what the recording shows.
#
#   ANTHROPIC_API_KEY=... PR_TITLE='...' PR_BODY='...' DIFFSTAT='...' \
#   CLIP_SECONDS=42 bash scripts/ship/pr-video-script.sh <out.txt>
#
# CLIP_SECONDS is how long the recording runs; the script is asked for about
# that many seconds of speech, so the voice stops when the picture does.
#
# The model is pinned here, exactly, and is not overridable: the reviewer's
# Sonnet (scripts/claude-review.mjs). It used to be Haiku, whose default
# thinking spent the whole 400-token budget and left no narration on PR 54
# (run 40289576297), so thinking is now sent switched off and the budget is
# 1024 tokens. One line on stdout, `narration-model: ...`, says how it
# answered (stop_reason, block types, token counts; never the key).
#
# An answer with no text, one cut off at max_tokens, or one under MIN_WORDS
# words is a hard failure: no video is published rather than a half-spoken one.
# The API answering badly (no 200) falls back to a plain script and says
# `script=fallback` on stdout. A missing key is a hard failure too. Exit 0 on
# success, 1 on any of those failures, 2 on a usage error. The key goes to
# curl in a config on stdin, never in argv.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,20p' "$0"; exit 0 ;; esac

API="https://api.anthropic.com/v1/messages"
API_VERSION="2023-06-01"
MODEL="claude-sonnet-5-5"
MAX_TOKENS=1024
# Words per second of clip, read aloud at a comfortable pace, and the range the
# answer is held to. The narration is fitted to the recording rather than the
# other way round: a script longer than the walkthrough leaves the video frozen
# on its last frame while a voice talks over it.
WORDS_PER_SECOND=2.2
MIN_WORDS=25
MAX_WORDS=130
DEFAULT_SECONDS=30

[ $# -eq 1 ] || { echo "usage: pr-video-script.sh <out.txt>" >&2; exit 2; }
out="$1"
# Nothing from an earlier run may be mistaken for this one's narration.
rm -f "$out"
command -v jq >/dev/null 2>&1 || { echo "::error::jq is required" >&2; exit 2; }

title="${PR_TITLE:-this pull request}"
body="${PR_BODY:-}"
diffstat="${DIFFSTAT:-}"
words="$(awk -v s="${CLIP_SECONDS:-$DEFAULT_SECONDS}" -v r="$WORDS_PER_SECOND" \
  -v lo="$MIN_WORDS" -v hi="$MAX_WORDS" 'BEGIN {
    n = s * r
    if (!(n >= lo)) n = lo
    if (n > hi) n = hi
    printf "%d", n
  }')"

# Just the steps, when the pull request wrote any: the rest of a body is spec,
# checklists and the video link, which say nothing about what is on screen.
steps="$(printf '%s\n' "$body" | awk '
  tolower($0) ~ /^#+[[:space:]]*how to see it[[:space:]]*$/ { inside = 1; next }
  /^#+[[:space:]]/ { inside = 0 }
  inside { print }' | sed '/^[[:space:]]*$/d')"

fallback() {
  {
    printf '%s.\n' "$title"
    if [ -n "$steps" ]; then
      printf 'The walkthrough follows the steps on the pull request:\n%s\n' "$steps"
    fi
    [ -z "$diffstat" ] || printf 'The change is %s.\n' "$diffstat"
  } >"$out"
  echo "script=fallback"
  exit 0
}

[ -n "${ANTHROPIC_API_KEY:-}" ] || {
  echo "::error::ANTHROPIC_API_KEY is not set, so there is nothing to narrate the explainer with" >&2
  exit 1
}

read -r -d '' prompt <<EOF || true
Write the voice-over for a short screen recording of a pull request, for the
people who will review it.

Pull request title: $title

The recording follows these steps, if any are listed:
$steps

Diff stat: $diffstat

Rules:
- At most $words words, plain spoken English, no headings, no bullet points,
  no markdown, no stage directions, no emoji.
- Say what changed and what the viewer is looking at. Do not read the diff stat out.
- Do not invent anything that is not in the title or the steps above.
- Answer with the voice-over only.
EOF

request="$(jq -nc --arg model "$MODEL" --argjson max "$MAX_TOKENS" --arg prompt "$prompt" \
  '{model: $model, max_tokens: $max, thinking: {type: "disabled"},
    messages: [{role: "user", content: $prompt}]}')" || {
  echo "::error::could not build the narration request" >&2
  exit 2
}

reply="$(mktemp)"
err="$(mktemp)"
trap 'rm -f "$reply" "$err"' EXIT

status="$(printf 'header = "x-api-key: %s"\nheader = "anthropic-version: %s"\nheader = "content-type: application/json"\nurl = "%s"\ndata = %s\noutput = "%s"\nwrite-out = "%%{http_code}"\n' \
  "$ANTHROPIC_API_KEY" "$API_VERSION" "$API" "$(jq -Rs . <<<"$request")" "$reply" |
  curl -sS --max-time 90 -K - 2>"$err")" || status=''

if [ "$status" != 200 ]; then
  echo "::warning::$MODEL answered ${status:-no status}; narrating from the pull request instead" >&2
  fallback
fi

# How the model answered, on one line, whatever it answered.
jq -r --arg model "$MODEL" '"narration-model: model=\($model) stop_reason=\(.stop_reason // "none")" +
  " blocks=\([.content[]?.type] | if length == 0 then "none" else join(",") end)" +
  " input_tokens=\(.usage.input_tokens // "?") output_tokens=\(.usage.output_tokens // "?")"' \
  "$reply" 2>/dev/null || echo "narration-model: model=$MODEL reply=unreadable"

# Only the text blocks are the narration.
text="$(jq -r '[.content[]? | select(.type == "text") | .text] | join("") | gsub("^\\s+|\\s+$"; "")' "$reply" 2>/dev/null || true)"
stop="$(jq -r '.stop_reason // ""' "$reply" 2>/dev/null || true)"
if [ "$stop" = max_tokens ]; then
  echo "::error::$MODEL stopped with stop_reason=max_tokens: it ran out of room before the narration was finished, so no video is published" >&2
  exit 1
fi
if [ -z "$text" ] || [ "$text" = null ]; then
  echo "::error::$MODEL left no narration (no text in its answer), so no video is published" >&2
  exit 1
fi
count="$(wc -w <<<"$text" | tr -d ' ')"
if [ "$count" -lt "$MIN_WORDS" ]; then
  echo "::error::$MODEL wrote $count words of narration; a video needs at least $MIN_WORDS, so no video is published" >&2
  exit 1
fi

printf '%s\n' "$text" >"$out"
echo "script=model words=$count asked=$words"

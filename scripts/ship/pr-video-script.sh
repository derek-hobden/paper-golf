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
# The model is pinned here and is not overridable. It is Haiku, not the
# reviewer's Sonnet: this is one short paragraph, and the point of the whole
# change is that a pull request costs very little.
#
# The API answering badly is not a reason to ship no video, so a refusal falls
# back to a plain script built from the same three facts and says `script=fallback`
# on stdout. A missing key is still a hard failure: a video narrated from
# nothing is not what anyone asked for. Exit 0 on success, 1 with no key, 2 on
# a usage error. The key goes to curl in a config on stdin, never in argv.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,20p' "$0"; exit 0 ;; esac

API="https://api.anthropic.com/v1/messages"
API_VERSION="2023-06-01"
MODEL="claude-haiku-5-5"
MAX_TOKENS=400
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

request="$(jq -n --arg model "$MODEL" --argjson max "$MAX_TOKENS" --arg prompt "$prompt" \
  '{model: $model, max_tokens: $max, messages: [{role: "user", content: $prompt}]}')" || fallback

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

text="$(jq -r '[.content[]? | select(.type == "text") | .text] | join("") | gsub("^\\s+|\\s+$"; "")' "$reply" 2>/dev/null || true)"
if [ -z "$text" ] || [ "$text" = null ]; then
  echo "::warning::$MODEL left no narration; narrating from the pull request instead" >&2
  fallback
fi

printf '%s\n' "$text" >"$out"
echo "script=model words=$(wc -w <"$out" | tr -d ' ') asked=$words"

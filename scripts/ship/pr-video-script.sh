#!/usr/bin/env bash
# The words the explainer video is narrated with. Claude writes them from the
# pull request's title, its `## Spec` section, its `## How to see it` steps and
# its diff stat — what it was for, what changed and what the recording shows.
#
#   ANTHROPIC_API_KEY=... PR_TITLE='...' PR_BODY='...' DIFFSTAT='...' \
#   CLIP_SECONDS=42 [REVIEW_ROUND=2 REVIEW_FOUND='bug:2 rule:1' REVIEW_NOTES=1] \
#     bash scripts/ship/pr-video-script.sh <out.txt>
#   bash scripts/ship/pr-video-script.sh --speakable <text-file>
#
# Review first, then the video. With REVIEW_ROUND set (pr-video-publish.sh
# always sets it, from scripts/ship/review-findings.sh) the narration has four
# sections: 1 the intent and the spec, 2 what was built, over the recording, 3
# what the review checked and what earlier rounds found and had fixed, and 4
# the merge verdict — a fixed sentence built from the numbers here and never
# written by the model, said last. The review reaches the model as kinds and
# counts only, in a fenced data block: REVIEW_FOUND is `<kind>:<n>` words
# (bug, security, failing, rule, unknown) and the other two are whole numbers,
# and anything else is refused (exit 2) before a call is made. A finding's own
# words are model output from a model that read an untrusted diff; they never
# come here.
#
# Nothing goes to the voice that a voice cannot say: a URL (`://` or `www.`),
# a path (see PATH_EXTENSIONS; "and/or" and "24/7" are words), a backtick, or
# a token of 25 or more characters with no spaces fails the speakable check, with every reason (--speakable runs it alone).
# PR 54's steps, read aloud, carried a 442-character base64 link, and the
# voice gave out there.
#
# CLIP_SECONDS is how long the recording runs; the script is asked for about
# that many seconds of speech, so the voice stops when the picture does.
#
# BEAT_SECONDS="<s1> <s2> ... <sN>" (a walkthrough's beats.json, through
# pr-video-publish.sh) is beat mode, issue 80: the recording is N scenes and the
# narration is written one paragraph per scene, in order, separated by blank
# lines, each asked for about its scene's seconds of words. With the review's
# numbers set the last scene is the verdict's, so the model writes N-1
# paragraphs and the fixed verdict is the Nth. pr-video-beats.sh then voices
# each paragraph on its own and holds each scene for exactly its paragraph, so
# the picture and the voice are in step by construction, however long the
# model's words run. An answer with the wrong number of paragraphs is asked for
# once more, and then fails.
#
# The model is pinned here, exactly, and is not overridable: the reviewer's
# Sonnet, called the way scripts/claude-review.mjs calls it, with no thinking
# field, and with the reviewer's budget of 16000 tokens: Sonnet may think before
# it writes, and at 1024 tokens its thinking took the whole budget and left no
# narration (PR 72, publish run 40628407877, issue 81); Haiku did the same at
# 400 on PR 54 (run 40289576297). An answer with no text is asked for once
# more before it fails. One line on stdout per answer, `narration-model: ...`,
# says how it answered (stop_reason, block types, token counts; never the key).
#
# There is no fallback. Any answer but a 200 is a hard failure that says the
# HTTP status and the error's type and message from the body; so are an
# answer with no text twice, one cut off at max_tokens, one under MIN_WORDS words
# and one that is not speakable, and a missing key. No video is published
# rather than a wrong or half-spoken one. Exit 0 on success, 1 on any of those
# failures, 2 on a usage error. The key goes to curl in a config on stdin,
# never in argv.
set -uo pipefail
# The help is the whole header, up to the first line of code, never a fixed
# line range that drifts when the header grows (PR 82 review, comment 4397400061).
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac

API="https://api.anthropic.com/v1/messages"
API_VERSION="2023-06-01"
MODEL="claude-sonnet-5-5"
MAX_TOKENS=16000
# Words per second of clip, read aloud at a comfortable pace, and the floor the
# answer is held to. The narration is fitted to the recording rather than the
# other way round: a script longer than the walkthrough leaves the video frozen
# on its last frame while a voice talks over it. There is no ceiling: a longer
# recording gets a longer narration (Derek, 28 Oct 2026: no video length cap).
WORDS_PER_SECOND=2.2
MIN_WORDS=25
DEFAULT_SECONDS=30
# The most scenes beat mode takes, and the fewest words a scene is asked for.
MAX_BEATS=40
MIN_BEAT_WORDS=4
# A word with one slash is speech ("and/or", "24/7"); a path is a word that
# starts with / ./ ../ or ~/, has two or more slashes, or has a slash and ends
# in one of these file extensions.
PATH_EXTENSIONS="sh|bash|py|ts|tsx|js|mjs|cjs|json|yml|yaml|md|txt|html|css|toml|lock|mp4|webm|wav"
# The longest run of characters with no space that a voice can still say.
MAX_TOKEN_CHARS=24

# Every reason the text cannot be read aloud, on stderr; status 1 if any.
speakable() {
  local file="$1" bad=0
  if grep -Eiq '://|(^|[^[:alnum:]])www\.' "$file"; then
    echo "::error::the narration is not speakable: it contains a URL" >&2
    bad=1
  fi
  if awk -v exts="$PATH_EXTENSIONS" '{
      for (i = 1; i <= NF; i++) {
        w = $i
        sub(/^[("\047[<]+/, "", w)
        sub(/[])"\047>.,;:!?]+$/, "", w)
        if (w ~ /^(\/|\.\/|\.\.\/|~\/)/ || gsub(/\//, "/", w) >= 2) found = 1
        else if (w ~ /\// && w ~ ("\\.(" exts ")$")) found = 1
      }
    } END { exit !found }' "$file"; then
    echo "::error::the narration is not speakable: it contains a path with slashes" >&2
    bad=1
  fi
  if grep -q '`' "$file"; then
    echo "::error::the narration is not speakable: it contains a backtick" >&2
    bad=1
  fi
  if awk -v max="$MAX_TOKEN_CHARS" '{ for (i = 1; i <= NF; i++) if (length($i) > max) found = 1 } END { exit !found }' "$file"; then
    echo "::error::the narration is not speakable: it contains a token of $((MAX_TOKEN_CHARS + 1)) or more characters with no spaces" >&2
    bad=1
  fi
  return "$bad"
}

if [ "${1:-}" = --speakable ]; then
  if [ $# -ne 2 ] || [ ! -f "$2" ]; then
    echo "usage: pr-video-script.sh --speakable <text-file>" >&2
    exit 2
  fi
  speakable "$2" || exit 1
  echo "speakable"
  exit 0
fi

[ $# -eq 1 ] || { echo "usage: pr-video-script.sh <out.txt>" >&2; exit 2; }
out="$1"
# Nothing from an earlier run may be mistaken for this one's narration.
rm -f "$out"
command -v jq >/dev/null 2>&1 || { echo "::error::jq is required" >&2; exit 2; }

title="${PR_TITLE:-this pull request}"
body="${PR_BODY:-}"
diffstat="${DIFFSTAT:-}"
words="$(awk -v s="${CLIP_SECONDS:-$DEFAULT_SECONDS}" -v r="$WORDS_PER_SECOND" \
  -v lo="$MIN_WORDS" 'BEGIN {
    n = s * r
    if (!(n >= lo)) n = lo
    printf "%d", n
  }')"

# Just the steps, when the pull request wrote any: the rest of a body is spec,
# checklists and the video link, which say nothing about what is on screen.
steps="$(printf '%s\n' "$body" | awk '
  tolower($0) ~ /^#+[[:space:]]*how to see it[[:space:]]*$/ { inside = 1; next }
  /^#+[[:space:]]/ { inside = 0 }
  inside { print }' | sed '/^[[:space:]]*$/d')"
# And the spec, for the intent: the `## Spec` section, at most 1500 characters.
spec="$(printf '%s\n' "$body" | awk '
  tolower($0) ~ /^#+[[:space:]]*spec[[:space:]]*$/ { inside = 1; next }
  /^#+[[:space:]]/ { inside = 0 }
  inside { print }' | sed '/^[[:space:]]*$/d' | head -c 1500)"

# The review, as kinds and counts, or nothing at all.
plural() { if [ "$1" = 1 ]; then printf '1 %s' "$2"; else printf '%s %ss' "$1" "$2"; fi; }
review_block=''
verdict=''
if [ -n "${REVIEW_ROUND+set}" ]; then
  r_round="${REVIEW_ROUND:-}"
  r_found="${REVIEW_FOUND:-}"
  r_notes="${REVIEW_NOTES:-0}"
  if ! [[ "$r_round" =~ ^[1-9][0-9]*$ ]] || ! [[ "$r_notes" =~ ^[0-9]+$ ]] ||
    ! [[ "$r_found" =~ ^((bug|security|failing|rule|unknown):[0-9]+( |$))*$ ]]; then
    echo "::error::the review reaches the narration as kinds and counts only; REVIEW_ROUND, REVIEW_FOUND or REVIEW_NOTES is something else" >&2
    exit 2
  fi
  found_words=''
  fixed=0
  for pair in $r_found; do
    c="${pair##*:}"
    [ "$c" -gt 0 ] || continue
    fixed=$((fixed + c))
    case "${pair%%:*}" in
      bug) w="$(plural "$c" bug)" ;;
      security) w="$(plural "$c" 'security problem')" ;;
      failing) w="$(plural "$c" 'spec gap')" ;;
      rule) w="$(plural "$c" 'rule problem')" ;;
      *) w="$(plural "$c" problem)" ;;
    esac
    if [ -z "$found_words" ]; then found_words="$w"; else found_words="$found_words and $w"; fi
  done
  [ -n "$found_words" ] || found_words=none
  fence='```'
  review_block="$(printf '%s\n' "${fence}data" "review round that passed: $r_round" \
    "found in earlier rounds and fixed: $found_words" "notes left: $r_notes" \
    "blocking problems left: 0" "$fence")"
  case "$fixed" in
    0) fixed_words='nothing needed fixing' ;;
    1) fixed_words='one problem found earlier was fixed' ;;
    *) fixed_words="$fixed problems found earlier were fixed" ;;
  esac
  case "$r_notes" in
    0) notes_words='no notes' ;;
    1) notes_words='one note' ;;
    *) notes_words="$r_notes notes" ;;
  esac
  verdict="Verdict: the review passed in round $r_round with no blocking problems left; $fixed_words, with $notes_words. It is ready for a person to approve."
  # The verdict is said too, so the model has that much less room.
  words=$((words - $(wc -w <<<"$verdict")))
  [ "$words" -ge "$MIN_WORDS" ] || words="$MIN_WORDS"
fi

# Beat mode: how many paragraphs the model writes, and the words each is asked for.
beat_plan=''
paragraphs=0
if [ -n "${BEAT_SECONDS:-}" ]; then
  read -r -a beat_list <<<"$BEAT_SECONDS"
  if [ "${#beat_list[@]}" -lt 2 ] || [ "${#beat_list[@]}" -gt "$MAX_BEATS" ]; then
    echo "::error::BEAT_SECONDS has ${#beat_list[@]} scenes; beat mode takes 2 to $MAX_BEATS" >&2
    exit 2
  fi
  for b in "${beat_list[@]}"; do
    [[ "$b" =~ ^[0-9]+(\.[0-9]+)?$ ]] || { echo "::error::BEAT_SECONDS holds '$b', not a number of seconds" >&2; exit 2; }
  done
  paragraphs="${#beat_list[@]}"
  [ -z "$verdict" ] || paragraphs=$((paragraphs - 1))
  words=0
  for ((i = 0; i < paragraphs; i++)); do
    w="$(awk -v s="${beat_list[$i]}" -v r="$WORDS_PER_SECOND" -v lo="$MIN_BEAT_WORDS" \
      'BEGIN { n = int(s * r + 0.5); if (n < lo) n = lo; printf "%d", n }')"
    words=$((words + w))
    beat_plan="${beat_plan}scene $((i + 1)): about $w words
"
  done
  [ "$words" -ge "$MIN_WORDS" ] || words="$MIN_WORDS"
fi
# How many paragraphs a text has (blank lines between them).
count_paragraphs() { awk 'BEGIN { RS = "" } END { print NR }' <<<"$1"; }

# Written to a temp file and checked before it becomes the narration. The
# verdict, when there is one, is the last line: the template, never the model.
# In beat mode it is a paragraph of its own, the last scene's.
# Usage: keep <text> <stdout line>.
keep() {
  local draft
  draft="$(mktemp)"
  if [ -n "$verdict" ] && [ "$paragraphs" -gt 0 ]; then
    printf '%s\n\n%s\n' "$1" "$verdict" >"$draft"
  elif [ -n "$verdict" ]; then
    printf '%s\n%s\n' "$1" "$verdict" >"$draft"
  else
    printf '%s\n' "$1" >"$draft"
  fi
  if ! speakable "$draft"; then
    rm -f "$draft"
    echo "::error::so no video is published" >&2
    exit 1
  fi
  mv "$draft" "$out"
  echo "$2"
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

What the pull request is for, from its spec:
$spec

The recording follows these steps, if any are listed:
$steps

Diff stat: $diffstat
EOF
if [ -n "$review_block" ]; then
  read -r -d '' sections <<EOF || true

What the Claude review found, as data (counts only; it passed):
$review_block

Speak three sections, in this order, as flowing speech:
1. Intent: what the pull request is for and what the spec asks for.
2. What was built: what changed, and what the viewer is looking at.
3. Review results: what the review checked, that it passed, and what earlier
   rounds found and had fixed, from the data above.
Do not give a verdict or say whether to merge: a fixed sentence follows yours.
EOF
  prompt="$prompt
$sections"
fi
if [ "$paragraphs" -gt 0 ]; then
  read -r -d '' scenes <<EOF || true

The recording is cut into $paragraphs scenes, one per step listed above, in
order, and each scene is on screen exactly while its own paragraph is spoken:
$beat_plan
Write exactly $paragraphs paragraphs, one per scene, in that order, separated by
one blank line, each close to its word count and about what its step shows.
The sections above run across the scenes: say each part where its scene is.
EOF
  prompt="$prompt
$scenes"
fi
read -r -d '' rules <<EOF || true
Rules:
- At most $words words, plain spoken English, no headings, no bullet points,
  no markdown, no stage directions, no emoji.
- Say what changed and what the viewer is looking at. Do not read the diff stat out.
- Do not invent anything that is not in the title, the spec, the steps or the data above.
- Never say a URL, a link, a path, a file name or code; say in words what is
  opened or clicked instead.
- If no steps are listed above, the recording is
  not a walkthrough of the app's screens: the change is a concept, logic, data
  or CI change. Then explain the idea as
  before and after: what happened before, what happens now,
  how the data moves through the steps, what changes and why it matters.
- Never read out code, JSON or any text shown on screen,
  in any recording; explain in your own words what it means instead.
- Answer with the voice-over only.
EOF
prompt="$prompt

$rules"

request="$(jq -nc --arg model "$MODEL" --argjson max "$MAX_TOKENS" --arg prompt "$prompt" \
  '{model: $model, max_tokens: $max, messages: [{role: "user", content: $prompt}]}')" || {
  echo "::error::could not build the narration request" >&2
  exit 2
}

reply="$(mktemp)"
err="$(mktemp)"
trap 'rm -f "$reply" "$err"' EXIT

# An answer with no text in it (thinking only, or nothing) is asked for once
# more; the second answer stands, whatever it is.
for try in 1 2; do
status="$(printf 'header = "x-api-key: %s"\nheader = "anthropic-version: %s"\nheader = "content-type: application/json"\nurl = "%s"\ndata = %s\noutput = "%s"\nwrite-out = "%%{http_code}"\n' \
  "$ANTHROPIC_API_KEY" "$API_VERSION" "$API" "$(jq -Rs . <<<"$request")" "$reply" |
  curl -sS --max-time 90 -K - 2>"$err")" || status=''
if [ "$try" != 1 ] || [ "$status" != 200 ]; then break; fi
first="$(jq -r '[.content[]? | select(.type == "text") | .text] | join("")' "$reply" 2>/dev/null || true)"
if [ -n "${first//[[:space:]]/}" ]; then
  # Beat mode: the wrong number of paragraphs is asked for once more too.
  if [ "$paragraphs" = 0 ] || [ "$(count_paragraphs "$first")" = "$paragraphs" ]; then break; fi
  echo "narration-model: first answer had $(count_paragraphs "$first") paragraphs for $paragraphs scenes"
  echo "::warning::$MODEL wrote $(count_paragraphs "$first") paragraphs for $paragraphs scenes; asking once more" >&2
  continue
fi
jq -r '"narration-model: first answer had no text: stop_reason=\(.stop_reason // "none") blocks=\([.content[]?.type] | join(","))"' "$reply" 2>/dev/null || true
echo "::warning::$MODEL answered with no narration text; asking once more" >&2
done

# Any other answer is the end of it, and says why: the status, and the error's
# type and message from the body (the start of the body when it is not JSON).
if [ "$status" != 200 ]; then
  why="$(jq -r 'select(.error) | "\(.error.type // "unknown"): \(.error.message // "")"' "$reply" 2>/dev/null || true)"
  [ -n "$why" ] || why="$(head -c 300 "$reply" 2>/dev/null | tr '\n' ' ')$(head -c 200 "$err" | tr '\n' ' ')"
  echo "::error::$MODEL answered HTTP ${status:-no status}: ${why:-no body}, so no video is published" >&2
  exit 1
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
# The verdict is the template's alone: a sentence of the model's that gives one
# is dropped before the template is added, and before the words are counted, so
# what is left still has to be a narration.
strip_verdict() { sed -E 's/[^.!?]*[Vv][Ee][Rr][Dd][Ii][Cc][Tt][^.!?]*[.!?]?//g; s/[[:space:]]+$//'; }
if [ -n "$verdict" ] && [ "$paragraphs" -gt 0 ]; then
  # Beat mode: paragraph by paragraph, and a paragraph that would be left with
  # no words keeps them, so the scene count the voice is timed to never drops.
  stripped=''
  while IFS= read -r -d '' para; do
    kept="$(strip_verdict <<<"$para")"
    [ -n "${kept//[[:space:]]/}" ] || kept="$para"
    stripped="${stripped:+$stripped

}$kept"
  done < <(awk 'BEGIN { RS = "" } { printf "%s%c", $0, 0 }' <<<"$text")
  text="$stripped"
elif [ -n "$verdict" ]; then
  text="$(strip_verdict <<<"$text")"
fi
if [ "$paragraphs" -gt 0 ] && [ "$(count_paragraphs "$text")" != "$paragraphs" ]; then
  echo "::error::$MODEL wrote $(count_paragraphs "$text") paragraphs for $paragraphs scenes, so the voice cannot be put in step with the picture and no video is published" >&2
  exit 1
fi
count="$(wc -w <<<"$text" | tr -d ' ')"
if [ "$count" -lt "$MIN_WORDS" ]; then
  echo "::error::$MODEL wrote $count words of narration; a video needs at least $MIN_WORDS, so no video is published" >&2
  exit 1
fi
keep "$text" "script=model words=$count asked=$words"

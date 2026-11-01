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
# Every video is for someone who was not in the loop: Derek six months later,
# or an overwhelmed manager with many approval requests (29 Oct 2026). So the
# narration runs, in this order: 1 the opening, about the first OPENING_SECONDS
# — what this pull request is, why it matters and what the viewer is being
# asked to decide, so someone who watches only that knows what is on their
# desk; 2 how it works today,
# from the real evidence; 3 what changed; 4 how it works after, from the real
# evidence; and 5, last, the review result in plain words. The fifth is a fixed
# paragraph built from the numbers here (review_sentence), never written by the
# model, and it says what each number means: never "verdict" or "round 2" on
# their own. With REVIEW_ROUND unset (no review) there is no fifth part. The
# review reaches the model as kinds and
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
# numbers set the last scene is the review result's: the fixed paragraph is the
# last one and the model writes the other N-1, one for each of scenes 1 to N-1.
# pr-video-beats.sh then voices
# each paragraph on its own and holds each scene for exactly its paragraph, so
# the picture and the voice are in step by construction, however long the
# model's words run. An answer with the wrong number of paragraphs is asked for
# once more, and then kept with a warning (the publish makes that video without
# beats). So is one whose paragraph leaves out words its scene shows: every
# phrase a `## How to see it` step quotes is to be said in that scene's paragraph
# (unsaid), and the verdict filter never takes it out.
#
# The model is pinned here, exactly, and is not overridable: Sonnet (the review
# itself runs on Opus, scripts/claude-review.mjs), with no thinking field and a
# budget of 16000 tokens: Sonnet may think before
# it writes, and at 1024 tokens its thinking took the whole budget and left no
# narration (PR 72, publish run 40628407877, issue 81); Haiku did the same at
# 400 on PR 54 (run 40289576297). An answer with no text is asked for once
# more before it fails. One line on stdout per answer, `narration-model: ...`,
# says how it answered (stop_reason, block types, token counts; never the key).
#
# There is no fallback narration. Any answer but a 200 is a hard failure that
# says the HTTP status and the error's type and message from the body; so are an
# answer with no text twice and a missing key: there is nothing to voice. A
# narration under MIN_WORDS words is asked for again, longer, up to
# SHORT_RETRIES more times (each stating the floor and asking for why, before,
# what changes and after). The word checks only warn, because the explainer
# video is best effort and never holds a merge (Derek, 1 Nov 2026): an answer
# cut off at max_tokens, one still under MIN_WORDS words after those asks, one
# that is not speakable, one with words on screen unsaid and one with the wrong
# number of paragraphs are kept, each with a warning in the log and the step
# summary (lib.sh ship_video_warning). Exit 0 when there is a narration, 1 when
# there is none, 2 on a usage error. The key goes to curl in a config on stdin,
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
# How many more times an answer under MIN_WORDS is asked for, longer.
SHORT_RETRIES=2
DEFAULT_SECONDS=30
# The opening says what is on the viewer's desk in about this many seconds.
OPENING_SECONDS=15
# The longest one scene of a scene script may say.
MAX_SCENE_CHARS=600
# The most scenes beat mode takes, and the fewest words a scene is asked for.
MAX_BEATS=40
MIN_BEAT_WORDS=4
# A word with one slash is speech ("and/or", "24/7"); a path is a word that
# starts with / ./ ../ or ~/, has two or more slashes, or has a slash and ends
# in one of these file extensions.
PATH_EXTENSIONS="sh|bash|py|ts|tsx|js|mjs|cjs|json|yml|yaml|md|txt|html|css|toml|lock|mp4|webm|wav"
# The longest run of characters with no space that a voice can still say.
MAX_TOKEN_CHARS=24

# Every reason the text cannot be read aloud, one a line on stdout; none when
# it can be.
unspeakable() {
  local file="$1"
  if grep -Eiq '://|(^|[^[:alnum:]])www\.' "$file"; then
    echo "it contains a URL"
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
    echo "it contains a path with slashes"
  fi
  if grep -q '`' "$file"; then
    echo "it contains a backtick"
  fi
  if awk -v max="$MAX_TOKEN_CHARS" '{ for (i = 1; i <= NF; i++) if (length($i) > max) found = 1 } END { exit !found }' "$file"; then
    echo "it contains a token of $((MAX_TOKEN_CHARS + 1)) or more characters with no spaces"
  fi
}
# The check on its own (--speakable): every reason on stderr; status 1 if any.
speakable() {
  local why line
  why="$(unspeakable "$1")"
  [ -n "$why" ] || return 0
  while IFS= read -r line; do echo "::error::the narration is not speakable: $line" >&2; done <<<"$why"
  return 1
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
# shellcheck source=scripts/ship/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
out="$1"
# Nothing from an earlier run may be mistaken for this one's narration.
rm -f "$out"
command -v jq >/dev/null 2>&1 || { echo "::error::jq is required" >&2; exit 2; }

title="${PR_TITLE:-this pull request}"
body="${PR_BODY:-}"
diffstat="${DIFFSTAT:-}"
opening_words="$(awk -v s="$OPENING_SECONDS" -v r="$WORDS_PER_SECOND" 'BEGIN { printf "%d", s * r }')"
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
  review_block="$(printf '%s\n' "${fence}data" "times the review read the change, the last one passing: $r_round" \
    "problems found before that and fixed: $found_words" "small suggestions left, which block nothing: $r_notes" \
    "problems left that block merging: 0" "$fence")"
  # The review result in plain words, said last: what the review is, what it
  # found and what that means for the merge (e2e/walkthroughs/review-first-scenes.ts
  # reviewWords shows the same words on screen).
  case "$r_round" in
    2) times='twice' ;;
    3) times='three times' ;;
    *) times="$r_round times" ;;
  esac
  case "$r_notes" in
    0) notes_words='' ;;
    1) notes_words=' It left one small suggestion, which does not block anything.' ;;
    *) notes_words=" It left $r_notes small suggestions, which do not block anything." ;;
  esac
  if [ "$r_round" = 1 ]; then
    looked='The automatic code review read the whole change and found no problems that block merging.'
  elif [ "$fixed" = 0 ]; then
    looked="The automatic code review read the whole change $times. It asked for changes first; they were made, and its last read found no problems that block merging."
  else
    if [ "$fixed" = 1 ]; then were='it was'; else were='they were'; fi
    looked="The automatic code review read the whole change $times. First it found $found_words; $were fixed, and its last read found no problems that block merging."
  fi
  verdict="$looked$notes_words So this is safe to merge once a person approves it."
  # The result is said too, so the model has that much less room.
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
  # With a review, the last scene is its fixed paragraph: the model's scenes
  # stop one short of it.
  last="${#beat_list[@]}"
  [ -z "$verdict" ] || last=$((last - 1))
  for ((i = 0; i < last; i++)); do
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

# The words on screen, in beat mode: every phrase a step quotes in double
# quotes is shown in that step's scene, so its paragraph says it (Gus on
# pr-98-4ff0dcb.mp4: "The rules say review result, not verdict" was on screen
# at 26.7 s and never said). One "<scene>\t<phrase>" line each, scene 0 when
# the steps are not one per scene and a phrase may be said anywhere.
shown=''
if [ "$paragraphs" -gt 0 ]; then
  shown="$(printf '%s\n' "$steps" | awk -v scenes="${#beat_list[@]}" '
    /^[[:space:]]*[-*][[:space:]]/ { line[++n] = $0 }
    END {
      for (k = 1; k <= n; k++) {
        s = line[k]
        while (match(s, /"[^"]+"/)) {
          print (n == scenes ? k : 0) "\t" substr(s, RSTART + 1, RLENGTH - 2)
          s = substr(s, RSTART + RLENGTH)
        }
      }
    }')"
fi
# The phrases reach awk through ENVIRON, never -v, which would read a backslash
# in a step as an escape. The words as they are spoken, to compare: lower case, punctuation as spaces,
# "PR" as "pull request" and a number word as its digits, since the voice says
# them the same either way.
NORM_AWK='
  BEGIN {
    split("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty", w, " ")
    for (i = 1; i <= 21; i++) digit[w[i]] = i - 1
  }
  function norm(s,   n, i, a, o) {
    s = tolower(s)
    while (match(s, /[0-9][.][0-9]/)) s = substr(s, 1, RSTART) " point " substr(s, RSTART + 2)
    gsub(/[^a-z0-9]+/, " ", s)
    n = split(s, a, " "); o = ""
    for (i = 1; i <= n; i++) {
      if (a[i] == "pr") a[i] = "pull request"
      else if (a[i] in digit) a[i] = digit[a[i]]
      o = o " " a[i]
    }
    return o " "
  }'
# The model's words with any sentence that gives a review verdict taken out,
# paragraph by paragraph: the review result is the template's alone. A
# sentence that says words its scene shows stays, whatever it says. In beat
# mode a paragraph left with no words keeps them, so the scene count never
# drops; otherwise it goes, so the review result is never said twice (PR 98
# review note 4411483767). A sentence ends at a . ! or ? followed by a space or
# the paragraph's end, never inside "5.5" (note 4411483899).
strip_verdict() {
  SHOWN="$shown" awk -v beat="$paragraphs" "$NORM_AWK"'
    BEGIN {
      RS = ""; ORS = "\n\n"
      n = split(ENVIRON["SHOWN"], rows, "\n")
      for (i = 1; i <= n; i++) {
        if (rows[i] == "") continue
        tab = index(rows[i], "\t")
        q[++nq] = norm(substr(rows[i], tab + 1)); qk[nq] = substr(rows[i], 1, tab - 1) + 0
      }
    }
    function onscreen(sentence, k,   i, t) {
      t = norm(sentence)
      for (i = 1; i <= nq; i++) if ((qk[i] == 0 || qk[i] == k) && index(t, q[i])) return 1
      return 0
    }
    {
      p = $0; kept = ""
      while (p != "") {
        if (match(p, /[.!?]+([[:space:]]|$)/)) { s = substr(p, 1, RSTART + RLENGTH - 1); p = substr(p, RSTART + RLENGTH) }
        else { s = p; p = "" }
        if (tolower(s) ~ /verdict/ && !onscreen(s, NR)) continue
        kept = kept s
      }
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", kept)
      out[NR] = (kept == "" && beat + 0 > 0) ? $0 : kept
    }
    END {
      for (i = 1; i <= NR; i++) if (out[i] != "") { printf "%s%s", (o++ ? "\n\n" : ""), out[i] }
      if (o) print ""
    }' <<<"$1"
}
# Every phrase shown in a scene that its paragraph never says, one
# "scene N shows "...", never said" line each; nothing when all are said.
unsaid() {
  SHOWN="$shown" awk -v last="$paragraphs" "$NORM_AWK"'
    BEGIN { RS = "" }
    { para[NR] = norm($0); all = all para[NR] }
    END {
      n = split(ENVIRON["SHOWN"], rows, "\n")
      for (i = 1; i <= n; i++) {
        if (rows[i] == "") continue
        tab = index(rows[i], "\t"); k = substr(rows[i], 1, tab - 1) + 0; phrase = substr(rows[i], tab + 1)
        if (k > last) continue
        if (!index(k == 0 ? all : para[k], norm(phrase)))
          printf "%s shows \"%s\", and its narration never says it\n", (k == 0 ? "the recording" : "scene " k), phrase
      }
    }' <<<"$1"
}

# Version numbers and model names as a voice says them, before the voice ever
# sees them (Gus on pr-98-8de94ab.mp4: "Claude Opus 5.5" came out as "Claude
# Opus 5.5 percent"): "5.5" is "five point five", "v2.2.2" is "version two point
# two point two", "claude-opus-5-5" is "Claude Opus five point five". A whole
# number up to twenty is its word, the digits after a point are said one by
# one, and every other word is left as it is.
SPOKEN_AWK='
  BEGIN {
    split("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty", w, " ")
    for (i = 1; i <= 21; i++) word[i - 1] = w[i]
  }
  function whole(n) { return (n ~ /^[0-9]+$/ && n !~ /^0[0-9]/ && n + 0 <= 20) ? word[n + 0] : n }
  function each(d,   i, o) { o = ""; for (i = 1; i <= length(d); i++) o = o (i > 1 ? " " : "") word[substr(d, i, 1) + 0]; return o }
  function version(v,   n, a, i, o) {
    n = split(v, a, "."); o = whole(a[1])
    for (i = 2; i <= n; i++) o = o " point " each(a[i])
    return o
  }
  function say(t,   lead, trail, core, a) {
    lead = ""; trail = ""
    if (match(t, /^[("\047[]+/)) { lead = substr(t, 1, RLENGTH); t = substr(t, RLENGTH + 1) }
    if (match(t, /[]).,;:!?"\047]+$/)) { trail = substr(t, RSTART); t = substr(t, 1, RSTART - 1) }
    core = t
    if (tolower(core) ~ /^claude-(opus|sonnet|haiku|fable)-[0-9]+-[0-9]+$/) {
      split(core, a, "-")
      core = "Claude " toupper(substr(a[2], 1, 1)) substr(a[2], 2) " " whole(a[3]) " point " each(a[4])
    } else if (core ~ /^[vV][0-9]+([.][0-9]+)+$/) core = "version " version(substr(core, 2))
    else if (core ~ /^[0-9]+([.][0-9]+)+$/) core = version(core)
    return lead core trail
  }
  BEGIN {
    while ((getline line) > 0) {
      n = split(line, tok, " "); out = ""
      for (i = 1; i <= n; i++) out = out (i > 1 ? " " : "") say(tok[i])
      print out
    }
  }'
spoken() { awk "$SPOKEN_AWK" "$1" >"$1.spoken" && mv "$1.spoken" "$1"; }

# Written to a temp file and checked before it becomes the narration. The
# review result, when there is one, is said last: the template, never the
# model. In beat mode it is a paragraph of its own, the last scene's.
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
  spoken "$draft"
  local why line
  why="$(unspeakable "$draft")"
  while IFS= read -r line; do
    [ -z "$line" ] || ship_video_warning "the narration is not speakable: $line; it is voiced as it is"
  done <<<"$why"
  mv "$draft" "$out"
  echo "$2"
  exit 0
}

# A walkthrough built with the motion kit (e2e/walkthroughs/motion.ts) writes down what each of
# its scenes says, from the very lines its scenes show: SCENE_SCRIPT is that file, a JSON list
# of one paragraph per scene. Then those words are said and no model writes any, so the voice
# can never say what the screen does not show, nor leave out what it does (Flo on
# pr-99-58eefae.mp4: "Pull requests are proposed changes" said over nothing at 0:04, and
# "Stamped with the commit, its saved version" over "commit 58eefae" at 1:10). With a review
# the last scene is the review result's: what it shows has to be the fixed paragraph, word for
# word, and the fixed paragraph is what is said. A scene script that does not fit
# is a warning, and the model writes the narration instead; a review scene that
# shows other words is a warning, and the fixed paragraph is still what is said
# (the video is best effort and never holds a merge, Derek, 1 Nov 2026).
if [ -n "${SCENE_SCRIPT:-}" ]; then
  [ "$paragraphs" -gt 0 ] || { echo "::error::SCENE_SCRIPT is for beat mode only" >&2; exit 2; }
  given="$(jq -r --argjson n "${#beat_list[@]}" --argjson max "$MAX_SCENE_CHARS" '
    if type == "array" and length == $n and all(.[]; type == "string" and (gsub("\\s"; "") | length) > 0 and length <= $max)
    then .[] | gsub("\\s+"; " ") | gsub("^ | $"; "") else empty end' "$SCENE_SCRIPT" 2>/dev/null || true)"
  if [ -z "$given" ] || [ "$(grep -c '' <<<"$given")" != "${#beat_list[@]}" ]; then
    ship_video_warning "the scene script is not ${#beat_list[@]} paragraphs of 1 to $MAX_SCENE_CHARS characters, one per scene, so the model writes the narration instead"
  else
    if [ -n "$verdict" ]; then
      shows="$(tail -n 1 <<<"$given")"
      if [ "$shows" != "$verdict" ]; then
        ship_video_warning "the review result scene shows \"$shows\", but the review result is \"$verdict\": the voice says the review result, so the picture and the voice do not match there"
      fi
      given="$(sed '$d' <<<"$given")"
    fi
    text="$(awk 'NR > 1 { print "" } { print }' <<<"$given")"
    keep "$text" "script=scenes words=$(wc -w <<<"$text" | tr -d ' ') scenes=${#beat_list[@]}"
  fi
fi

[ -n "${ANTHROPIC_API_KEY:-}" ] || {
  echo "::error::ANTHROPIC_API_KEY is not set, so there is nothing to narrate the explainer with" >&2
  exit 1
}

read -r -d '' prompt <<EOF || true
Write the voice-over for a short recording that explains a pull request (a
proposed change to the Paper Golf game's code or its build and release
tooling). Write it for someone who was not in the loop: an overwhelmed manager
with many approval requests, or the owner watching it six months from now, who
remembers none of the conversation behind it.

Pull request title: $title

What the pull request is for, from its spec:
$spec

The recording follows these steps, if any are listed:
$steps

Diff stat: $diffstat
EOF
read -r -d '' sections <<EOF || true

Speak four parts, in this order, as flowing speech:
1. The opening, the first $OPENING_SECONDS seconds (about $opening_words words): in plain
   words, what this pull request is, why it matters, and what the viewer is
   being asked to decide (whether to approve this change), so someone who
   watches only the opening knows what is on their desk.
2. How it works today: what happens before this change, from the real evidence
   the recording shows.
3. What changed: what this pull request does differently.
4. How it works after: the real evidence of the change working.
EOF
prompt="$prompt

$sections"
if [ -n "$review_block" ]; then
  read -r -d '' sections <<EOF || true

What the automatic code review found, as data (counts only; it passed):
$review_block

Do not talk about the review or recommend whether to merge: a fixed paragraph
after your words wraps up with the review result, last.
EOF
  prompt="$prompt

$sections"
fi
if [ "$paragraphs" -gt 0 ]; then
  beat_last=''
  [ -z "$verdict" ] || beat_last="
The last scene, scene ${#beat_list[@]}, is the review result: a fixed paragraph
says it after your words, so write nothing for it and stop at scene $paragraphs."
  read -r -d '' scenes <<EOF || true

The recording is cut into scenes, one per step listed above, in order, and
each scene is on screen exactly while its own paragraph is spoken.$beat_last
$beat_plan
Write exactly $paragraphs paragraphs, one for each scene listed just above, in
that order, separated by one blank line, each close to its word count and about
what its step shows. The parts above run across the scenes: say each part
where its scene is, and start with the opening in scene 1. Each paragraph says
only what its own scene shows: where a
step gives words in double quotes, those words are on screen in that scene, so
say them word for word, and say nothing that no step shows. Quoted words are
said exactly as shown even when the rules below would put them another way:
the words on screen and the words spoken must match.
EOF
  prompt="$prompt

$scenes"
fi
read -r -d '' rules <<EOF || true
Rules:
- At most $words words, plain spoken English, no headings, no bullet points,
  no markdown, no stage directions, no emoji.
- Say what changed and what the viewer is looking at. Do not read the diff stat out.
- Explain every project word the first time you use it, in plain words. Never
  use jargon on its own, such as verdict, round, NIT, blocker, gate, shard or
  ready mark: say what it means instead. Words a step quotes are the one
  exception: say them as shown, then explain them if they need it.
- Do not invent anything that is not in the title, the spec, the steps or the data above.
- Never say a URL, a link, a path, a file name or code; say in words what is
  opened or clicked instead.
- If no steps are listed above, the recording is
  not a walkthrough of the app's screens: the change is a concept, logic, data
  or CI change. Then explain the idea as
  before and after: what happened before, what happens now,
  how the data moves through the steps, what changes and why it matters.
- Never read out code, JSON or any text shown on screen,
  in any recording; explain in your own words what it means instead. The one
  exception is words a step gives in double quotes: say those as shown.
- Answer with the voice-over only.
EOF
prompt="$prompt

$rules"
base_prompt="$prompt"

build_request() {
  request="$(jq -nc --arg model "$MODEL" --argjson max "$MAX_TOKENS" --arg prompt "$1" \
    '{model: $model, max_tokens: $max, messages: [{role: "user", content: $prompt}]}')" || {
    echo "::error::could not build the narration request" >&2
    exit 2
  }
}
reply="$(mktemp)"
err="$(mktemp)"
trap 'rm -f "$reply" "$err"' EXIT

# A narration under MIN_WORDS is asked for again, longer, up to SHORT_RETRIES
# more times, with the floor stated (PR 96: a two-step recording was asked for
# at most 25 words and got 23, on both attempts of publish run 40824078104).
for short_try in $(seq 0 "$SHORT_RETRIES"); do
build_request "$prompt"

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
  if [ "$paragraphs" != 0 ] && [ "$(count_paragraphs "$first")" != "$paragraphs" ]; then
    echo "narration-model: first answer had $(count_paragraphs "$first") paragraphs for $paragraphs scenes"
    echo "::warning::$MODEL wrote $(count_paragraphs "$first") paragraphs for $paragraphs scenes; asking once more" >&2
    continue
  fi
  # And words a scene shows that its paragraph leaves out: asked for once more,
  # naming them.
  missing="$(unsaid "$(strip_verdict "$first")")"
  [ -n "$missing" ] || break
  echo "narration-model: first answer left $(grep -c . <<<"$missing") shown phrases unsaid"
  echo "::warning::$MODEL left words on screen unsaid; asking once more" >&2
  build_request "$prompt

Your last answer left these words on screen unsaid. Say each one word for word in its own scene's paragraph:
$missing"
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
if [ -z "$text" ] || [ "$text" = null ]; then
  echo "::error::$MODEL left no narration (no text in its answer${stop:+, stop_reason=$stop}), so no video is published" >&2
  exit 1
fi
# The review result is the template's alone: a sentence of the model's that
# gives a verdict is dropped (strip_verdict, which keeps words a scene shows)
# before the template is added, and before the words are counted, so what is
# left still has to be a narration.
[ -z "$verdict" ] || text="$(strip_verdict "$text")"
count="$(wc -w <<<"$text" | tr -d ' ')"
if [ "$count" -ge "$MIN_WORDS" ]; then break; fi
if [ "$short_try" -ge "$SHORT_RETRIES" ]; then
  # Still short after every ask: kept, with a warning (the video is best effort).
  ship_video_warning "$MODEL wrote $count words of narration; a video is asked for at least $MIN_WORDS"
  break
fi
echo "narration-model: answer had $count words, under the $MIN_WORDS a video needs"
echo "::warning::$MODEL wrote $count words of narration, under $MIN_WORDS; asking for a longer one" >&2
keep_paragraphs=''
[ "$paragraphs" = 0 ] || keep_paragraphs=" Keep exactly $paragraphs paragraphs, one per scene."
prompt="$base_prompt

Your last answer had $count words, and a narration needs at least $MIN_WORDS words.
Write it again, longer: at least $MIN_WORDS words, which overrides the word limit
above. Cover why the change was made, what happened before it, what it changes,
and what happens after it.$keep_paragraphs"
done
# From here on there is a narration, the last answer's, and what is wrong with it
# is a warning, never a failure.
if [ "$stop" = max_tokens ]; then
  ship_video_warning "$MODEL stopped with stop_reason=max_tokens: it ran out of room before the narration was finished, so the voice may stop mid-sentence"
fi
# Every word on screen is to be said: a scene whose paragraph leaves out words
# it shows is a warning, naming them (the audio gate then listens against this
# text).
missing="$(unsaid "$text")"
if [ -n "$missing" ]; then
  while IFS= read -r line; do [ -z "$line" ] || ship_video_warning "$line"; done <<<"$missing"
  ship_video_warning "$MODEL left words on screen unsaid, so the picture and the voice do not match everywhere"
fi
if [ "$paragraphs" -gt 0 ] && [ "$(count_paragraphs "$text")" != "$paragraphs" ]; then
  ship_video_warning "$MODEL wrote $(count_paragraphs "$text") paragraphs for $paragraphs scenes, so the voice cannot be put in step with the picture"
fi
keep "$text" "script=model words=$count asked=$words"

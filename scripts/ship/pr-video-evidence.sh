#!/usr/bin/env bash
# The evidence half of a pull request's video: real GitHub runs, recorded live
# by CI. A checked-in walkthrough names what it wants shown on lines of its own,
#
#   // walkthrough-evidence: <caption> | <command>
#
# and this runs each command for real, with the job's read-only token, in a
# terminal of COLS x ROWS recorded by `script` (util-linux): every byte the
# command wrote and when it wrote it. The explainer plays that recording back
# in a terminal emulator (xterm.js) at its own size, with the caption over it
# and the recorder's stamp under it. Nothing here is a mock-up, and nothing
# recorded is ever committed: the artifact lives for a day.
#
#   BASE=<sha> HEAD=<sha> GH_REPO=<owner/repo> GH_TOKEN=<read token> \
#     bash scripts/ship/pr-video-evidence.sh <outdir>
#
# The walkthrough is the one the recorder films (pr-video-record.sh --plan).
# Its commands are a short allowlist, run as arguments and never through a
# shell, so a spec cannot run anything else with the token:
#
#   run <id> [attempt <n>]                      gh run view <id> [--attempt <n>], less the runner's annotations
#   log <id> [attempt <n>] match <regex>        gh run view <id> [--attempt <n>] --log | grep -E <regex> | cut -f1,3
#   runs <workflow file> <branch>               gh run list --workflow <file> --branch <branch> --limit 8
#   checks <pr>                                 gh pr checks <pr>
#   pr <pr>                                     gh pr view <pr>: the pull request's page, its first PR_ROWS lines
#   comment <id>                                gh api repos/<repo>/issues/comments/<id> (who, when, the body)
#   review <pr>                                 scripts/ship/review-findings.sh for HEAD (it prints its counts),
#                                               and the result in plain words as the clip's headline
#   blockers <pr> <full sha>                    this checkout's pr-signal.sh blockers, print-only
#                                               (SIGNAL_PRINT=1): the PR blockers comment it would
#                                               write for that commit's real runs, nothing written
#
# <outdir>/evidence.json is a list of clips, {caption, command, captured_at, ok,
# cols, rows, recorder, stream (the terminal's bytes, base64), timing ([seconds
# since the last chunk, bytes] per chunk), lines (the text, colours and cursor
# moves left out), headline}. A recording is cut at MAX_BYTES. A command that
# fails is a clip with ok false and its own error, never a failed job: the
# explainer still films without it. Exit 0, or 2 on a usage error.
set -uo pipefail
self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
dir="$(dirname "$self")"
COLS=100
ROWS=24
# The pull request page's rows a clip shows: the terminal less the prompt.
PR_ROWS=$((ROWS - 2))
RUN_TIDY='/ANNOTATIONS/ { s = 1 } /View this run/ { s = 0 } !s'

# Inside the recorded terminal: the prompt, then the one command, nothing else.
# The words come from a file of NUL-separated arguments, never from a command line.
if [ "${1:-}" = --play ]; then
  mapfile -d '' -t a <"$2"
  shown="${a[0]}" kind="${a[1]}"
  args=("${a[@]:2}")
  stty cols "$COLS" rows "$ROWS" 2>/dev/null || true
  printf '\033[1;32m$\033[0m %s\n' "$shown"
  case "$kind" in
    # The runner's annotations are its own notices, not the run: left out, so the
    # run's status stays on the screen. GH_FORCE_TTY keeps gh's colours in a pipe.
    run)
      GH_FORCE_TTY="$COLS" gh run view "${args[@]}" | awk "$RUN_TIDY"
      exit "${PIPESTATUS[0]}" ;;
    log)
      # gh exits non-zero when one job of the run has no log (a skipped job), and
      # still prints the others: a line that matched is the evidence.
      gh run view "${args[@]:0:${#args[@]}-1}" --log | grep -E -- "${args[-1]}" | cut -f1,3 | fold -w "$COLS"
      st=("${PIPESTATUS[@]}")
      [ "${st[1]}" != 0 ] || exit 0
      # Nothing matched: say so on the screen, and the clip is not ok.
      printf 'No line of the log matched %s\n' "${args[-1]}"
      if [ "${st[0]}" != 0 ]; then exit "${st[0]}"; else exit 1; fi ;;
    runs) exec gh run list "${args[@]}" ;;
    checks) exec gh pr checks "${args[@]}" ;;
    # The page as gh draws it in a terminal (title, state, labels, checks, the
    # top of the body), cut by awk, which reads to the end so gh is never cut off.
    pr)
      GH_FORCE_TTY="$COLS" gh pr view "${args[@]}" | awk -v n="$PR_ROWS" 'NR <= n'
      exit "${PIPESTATUS[0]}" ;;
    comment) exec gh api "${args[0]}" --jq '"\(.user.login) at \(.updated_at):\n\(.body)"' ;;
    blockers)
      PR="${args[0]}" SIGNAL_HEAD="${args[1]}" SIGNAL_PRINT=1 SHIP_REPO="$GH_REPO" exec bash "$dir/pr-signal.sh" blockers ;;
    review)
      # review-findings.sh prints its counts itself.
      PR="${args[0]}" RUN_HEAD_SHA="${HEAD:-}" SHIP_REPO="$GH_REPO" exec bash "$dir/review-findings.sh" "${args[1]}" ;;
  esac
  exit
fi

case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac
[ $# -eq 1 ] || { echo "usage: pr-video-evidence.sh <outdir> (see --help)" >&2; exit 2; }
out="$1"
[ -n "${GH_REPO:-}" ] || { echo "GH_REPO is not set" >&2; exit 2; }
for tool in jq script base64; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required" >&2; exit 2; }
done
MAX_CLIPS=12
MAX_LINES=40
MAX_BYTES=65536
# The longest one command may take, the gh call and the terminal together.
CMD_TIMEOUT=60
recorder="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-$GH_REPO}/actions/runs/${GITHUB_RUN_ID:-local}"
[ -n "${GITHUB_RUN_ID:-}" ] || recorder="a local run"

mkdir -p "$out"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
clips="$work/clips"
: >"$clips"

# The walkthroughs the recorder films, from its own plan.
plan="$(bash "$dir/pr-video-record.sh" --plan 2>&1)" || {
  echo "::warning::evidence: the recorder's plan failed, so no evidence is captured: $(tail -n 1 <<<"$plan")"
  printf '[]\n' >"$out/evidence.json"
  exit 0
}
specs="$(sed -n 's/^record: filming \([^ ]*\) (.*$/\1/p' <<<"$plan")"

# The review's result in plain words, from review-findings.sh's counts.
plural() { if [ "$1" = 1 ]; then echo "1 $2"; else echo "$1 ${2}s"; fi; }
review_words() {
  local counts="$1" notes fixed round
  notes="$(sed -n 's/^notes=//p' "$counts")" fixed="$(sed -n 's/^fixed=//p' "$counts")" round="$(sed -n 's/^round=//p' "$counts")"
  local words="Passed in round ${round:-?}: "
  if [ "${notes:-0}" = 0 ]; then words+="no notes, no blockers"; else words+="$(plural "$notes" 'minor note'), no blockers"; fi
  [ "${fixed:-0}" = 0 ] || words+=", after $(plural "$fixed" problem) found in earlier rounds were fixed"
  echo "$words"
}

# record <caption> <shown> <kind> <arg>...: one clip, the command recorded in a
# terminal of its own.
record() {
  local caption="$1" shown="$2" kind="$3" rc=0 hdr sum ok headline=''
  shift 2
  printf '%s\0' "$shown" "$@" >"$work/args"
  rm -rf "$work/ts" "$work/tm" "$work/review"
  [ "$kind" != review ] || printf '%s\0' "$shown" "$@" "$work/review" >"$work/args"
  GLAMOUR_STYLE=dark GH_PAGER=cat PAGER=cat GH_PROMPT_DISABLED=1 TERM=xterm-256color \
    timeout "$CMD_TIMEOUT" script -q -e -T "$work/tm" -O "$work/ts" \
    -c "bash $(printf %q "$self") --play $(printf %q "$work/args")" </dev/null >/dev/null 2>&1 || rc=$?
  if ! [ -s "$work/ts" ] || ! [ -s "$work/tm" ]; then
    printf 'Script started\nevidence: the terminal recorded nothing (exit %s)\r\n' "$rc" >"$work/ts"
    printf '0 %s\n' "$(($(tail -n 1 "$work/ts" | wc -c)))" >"$work/tm"
  fi
  # The typescript opens with script's own "Script started" line and ends with
  # its "Script done" line; the timing file covers exactly what is between.
  hdr="$(head -n 1 "$work/ts" | wc -c)"
  sum="$(awk '{ s += $2 } END { print s + 0 }' "$work/tm")"
  tail -c "+$((hdr + 1))" "$work/ts" >"$work/body"
  [ "$sum" -le "$MAX_BYTES" ] || sum="$MAX_BYTES"
  truncate -s "$sum" "$work/body"
  case "$kind" in
    # gh pr checks exits 1 when a check failed and 8 while one is pending: what
    # it printed is still the evidence. An HTTP error, or any other exit, is
    # gh's own failure.
    checks) case "$rc" in 0 | 1 | 8) ok=true ;; *) ok=false ;; esac
      if grep -q 'HTTP [0-9][0-9][0-9]' "$work/body"; then ok=false; fi ;;
    *) if [ "$rc" = 0 ]; then ok=true; else ok=false; fi ;;
  esac
  if [ "$kind" = review ]; then
    if [ "$ok" = true ] && [ -s "$work/review/counts" ]; then headline="$(review_words "$work/review/counts")"
    else headline="No passed review was found for this commit"; fi
  fi
  # The text without colours, cursor moves or the spinner's carriage returns.
  sed -E 's/\x1b\[[0-9;?]*[A-Za-z]//g; s/\x1b\][^\x07\x1b]*(\x07|\x1b\\)//g; s/\r+$//; s/.*\r//' "$work/body" >"$work/text"
  jq -n --arg caption "$caption" --arg command "$shown" --argjson ok "$ok" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson cols "$COLS" --argjson rows "$ROWS" \
    --arg recorder "$recorder" --arg headline "$headline" --argjson max "$MAX_LINES" --argjson cap "$sum" \
    --rawfile text "$work/text" --rawfile stream <(base64 -w0 "$work/body") --rawfile timing "$work/tm" \
    '{caption: $caption, command: $command, captured_at: $at, ok: $ok, cols: $cols, rows: $rows,
      recorder: $recorder, headline: $headline, stream: ($stream | rtrimstr("\n")),
      timing: ($timing | split("\n") | map(select(test("\\S")) | split(" ") | map(tonumber))
               | reduce .[] as $t ({n: 0, out: []}; if .n >= $cap then . else {n: (.n + $t[1]), out: (.out + [$t])} end) | .out),
      lines: ($text | split("\n") | map(select(test("\\S"))) | .[:$max])}' >>"$clips"
}

# A line that is not one of the allowed commands is said and left out.
skip() { echo "::warning::evidence: skipped '$1' (not one of the allowed commands; see --help)"; }

n=0
while IFS= read -r spec; do
  [ -n "$spec" ] || continue
  while IFS= read -r entry; do
    [ "$n" -lt "$MAX_CLIPS" ] || break
    caption="${entry%%|*}"
    caption="${caption%"${caption##*[! ]}"}"
    cmd="${entry#*|}"
    cmd="${cmd#"${cmd%%[! ]*}"}"
    read -r -a w <<<"$cmd"
    attempt=() shown_attempt=''
    if [ "${w[2]:-}" = attempt ] && [[ "${w[3]:-}" =~ ^[0-9]+$ ]]; then
      attempt=(--attempt "${w[3]}") shown_attempt=" --attempt ${w[3]}"
      w=("${w[@]:0:2}" "${w[@]:4}")
    fi
    case "${w[0]:-}" in
      run)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${#w[@]}" != 2 ]; then skip "$entry"; continue; fi
        record "$caption" "gh run view ${w[1]}$shown_attempt | awk '$RUN_TIDY'" run "${w[1]}" "${attempt[@]}" ;;
      log)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${w[2]:-}" != match ] || [ -z "${w[3]:-}" ]; then skip "$entry"; continue; fi
        re="${cmd#* match }"
        record "$caption" "gh run view ${w[1]}$shown_attempt --log | grep -E '$re' | cut -f1,3" \
          log "${w[1]}" "${attempt[@]}" "$re" ;;
      runs)
        if ! [[ "${w[1]:-}" =~ ^[A-Za-z0-9_.-]+\.yml$ ]] || ! [[ "${w[2]:-}" =~ ^[A-Za-z0-9_./-]+$ ]] || [ "${#w[@]}" != 3 ]; then
          skip "$entry"
          continue
        fi
        record "$caption" "gh run list --workflow ${w[1]} --branch ${w[2]} --limit 8" \
          runs --workflow "${w[1]}" --branch "${w[2]}" --limit 8 ;;
      checks)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${#w[@]}" != 2 ]; then skip "$entry"; continue; fi
        record "$caption" "gh pr checks ${w[1]}" checks "${w[1]}" ;;
      pr)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${#w[@]}" != 2 ]; then skip "$entry"; continue; fi
        record "$caption" "gh pr view ${w[1]} | awk 'NR <= $PR_ROWS'" pr "${w[1]}" ;;
      comment)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${#w[@]}" != 2 ]; then skip "$entry"; continue; fi
        record "$caption" "gh api repos/$GH_REPO/issues/comments/${w[1]}" comment "repos/$GH_REPO/issues/comments/${w[1]}" ;;
      blockers)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || ! [[ "${w[2]:-}" =~ ^[0-9a-f]{40}$ ]] || [ "${#w[@]}" != 3 ]; then
          skip "$entry"
          continue
        fi
        record "$caption" "PR=${w[1]} SIGNAL_HEAD=${w[2]} SIGNAL_PRINT=1 bash scripts/ship/pr-signal.sh blockers" \
          blockers "${w[1]}" "${w[2]}" ;;
      review)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${#w[@]}" != 2 ]; then skip "$entry"; continue; fi
        record "$caption" "PR=${w[1]} bash scripts/ship/review-findings.sh review" review "${w[1]}" ;;
      *) skip "$entry"; continue ;;
    esac
    n=$((n + 1))
  done < <(sed -n 's#^// walkthrough-evidence: *\(.*[^ ]\) *$#\1#p' "$spec")
done <<<"$specs"

jq -s . "$clips" >"$out/evidence.json"
echo "evidence: $n clip(s) recorded from ${specs:-no walkthrough}"

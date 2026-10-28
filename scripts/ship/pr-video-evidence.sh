#!/usr/bin/env bash
# The evidence half of a pull request's video: real GitHub runs, captured live by
# CI. A checked-in walkthrough names what it wants shown on lines of its own,
#
#   // walkthrough-evidence: <caption> | <command>
#
# and this runs each command for real with the job's read-only token and keeps
# what it printed, so the explainer can play it back as a terminal clip with the
# caption over it. Nothing here is a mock-up: every line in a clip is a line gh
# printed, from the run or pull request the command names, at the time it says.
#
#   BASE=<sha> HEAD=<sha> GH_REPO=<owner/repo> GH_TOKEN=<read token> \
#     bash scripts/ship/pr-video-evidence.sh <outdir>
#
# The walkthrough is the one the recorder films (pr-video-record.sh --plan).
# Its commands are a short allowlist, run as gh arguments and never through a
# shell, so a spec cannot run anything else with the token:
#
#   run <id> [attempt <n>]                      gh run view <id> [--attempt <n>]
#   log <id> [attempt <n>] match <regex>        gh run view <id> [--attempt <n>] --log | grep -E <regex>
#   runs <workflow file> <branch>               gh run list --workflow <file> --branch <branch> --limit 8
#   checks <pr>                                 gh pr checks <pr>
#   comment <id>                                gh api repos/<repo>/issues/comments/<id> (who, when, the body)
#
# <outdir>/evidence.json is a list of clips, {caption, command, captured_at, ok,
# lines}: at most MAX_LINES lines of at most MAX_CHARS characters each. A
# command that fails is a clip with ok false and gh's own error, never a failed
# job: the explainer still films without it. Exit 0, or 2 on a usage error.
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac
[ $# -eq 1 ] || { echo "usage: pr-video-evidence.sh <outdir> (see --help)" >&2; exit 2; }
out="$1"
[ -n "${GH_REPO:-}" ] || { echo "GH_REPO is not set" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 2; }
dir="$(cd "$(dirname "$0")" && pwd)"
MAX_CLIPS=12
MAX_LINES=14
MAX_CHARS=140

mkdir -p "$out"
clips="$(mktemp)"
trap 'rm -f "$clips"' EXIT

# The walkthroughs the recorder films, from its own plan.
plan="$(bash "$dir/pr-video-record.sh" --plan 2>&1)" || {
  echo "::warning::evidence: the recorder's plan failed, so no evidence is captured: $(tail -n 1 <<<"$plan")"
  printf '[]\n' >"$out/evidence.json"
  exit 0
}
specs="$(sed -n 's/^record: filming \([^ ]*\) (.*$/\1/p' <<<"$plan")"

# One clip: the caption, the command as it would be typed, and what it printed.
add() {
  local caption="$1" shown="$2" ok="$3" text="$4"
  jq -n --arg caption "$caption" --arg command "$shown" --argjson ok "$ok" --arg text "$text" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson max "$MAX_LINES" --argjson width "$MAX_CHARS" \
    '{caption: $caption, command: $command, captured_at: $at, ok: $ok,
      lines: ($text | split("\n") | map(select(test("\\S"))) | .[:$max] | map(.[:$width]))}' >>"$clips"
}
# A log line is "job<TAB>step<TAB>time text": keep the job and the text, and
# leave out the runner echoing a step's own script (coloured) and raw JSON.
tidy_log() {
  awk -F '\t' '{ sub(/^[^ ]*Z /, "", $3) } $3 !~ /\033|^[{]/ { print $1 "  " $3 }'
}
# gh run view's summary, up to its annotations (runner notices, not the run),
# then the run's own link.
tidy_run() { awk '/^ANNOTATIONS/ { skip = 1 } /^View this run/ { skip = 0 } !skip'; }
# The command's output, or gh's error, and whether it ran.
capture() {
  local caption="$1" shown="$2" text
  shift 2
  if text="$("$@" 2>&1)"; then add "$caption" "$shown" true "$text"; else add "$caption" "$shown" false "$text"; fi
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
        if text="$(gh run view "${w[1]}" "${attempt[@]}" 2>&1)"; then
          add "$caption" "gh run view ${w[1]}$shown_attempt" true "$(tidy_run <<<"$text")"
        else
          add "$caption" "gh run view ${w[1]}$shown_attempt" false "$text"
        fi ;;
      log)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${w[2]:-}" != match ] || [ -z "${w[3]:-}" ]; then skip "$entry"; continue; fi
        re="${cmd#* match }"
        shown="gh run view ${w[1]}$shown_attempt --log | grep -E '$re'"
        if text="$(gh run view "${w[1]}" "${attempt[@]}" --log 2>&1)"; then
          add "$caption" "$shown" true "$(grep -E -- "$re" <<<"$text" | tidy_log)"
        else
          add "$caption" "$shown" false "$text"
        fi ;;
      runs)
        if ! [[ "${w[1]:-}" =~ ^[A-Za-z0-9_.-]+\.yml$ ]] || ! [[ "${w[2]:-}" =~ ^[A-Za-z0-9_./-]+$ ]] || [ "${#w[@]}" != 3 ]; then
          skip "$entry"
          continue
        fi
        capture "$caption" "gh run list --workflow ${w[1]} --branch ${w[2]} --limit 8" \
          gh run list --workflow "${w[1]}" --branch "${w[2]}" --limit 8 ;;
      checks)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${#w[@]}" != 2 ]; then skip "$entry"; continue; fi
        # gh pr checks exits 1 when a check failed and 8 while one is pending: what
        # it printed is still the evidence. An HTTP error, or any other exit, is
        # gh's own failure.
        rc=0
        text="$(gh pr checks "${w[1]}" 2>&1)" || rc=$?
        case "$rc" in 0 | 1 | 8) ok=true ;; *) ok=false ;; esac
        if grep -q 'HTTP [0-9][0-9][0-9]' <<<"$text"; then ok=false; fi
        add "$caption" "gh pr checks ${w[1]}" "$ok" "$text" ;;
      comment)
        if ! [[ "${w[1]:-}" =~ ^[0-9]+$ ]] || [ "${#w[@]}" != 2 ]; then skip "$entry"; continue; fi
        capture "$caption" "gh api repos/$GH_REPO/issues/comments/${w[1]}" \
          gh api "repos/$GH_REPO/issues/comments/${w[1]}" --jq '"\(.user.login) at \(.updated_at):\n\(.body)"' ;;
      *) skip "$entry"; continue ;;
    esac
    n=$((n + 1))
  done < <(sed -n 's#^// walkthrough-evidence: *\(.*[^ ]\) *$#\1#p' "$spec")
done <<<"$specs"

jq -s . "$clips" >"$out/evidence.json"
echo "evidence: $n clip(s) captured from ${specs:-no walkthrough}"

#!/usr/bin/env bash
# What a required check says when it fails: one reason and one next step, in the
# two places a person looks — the check's own page and the PR blockers comment.
#
#   bash scripts/ship/check-summary.sh <check> <reason> [<next step>]
#   bash scripts/ship/check-summary.sh --next <check>
#
# Without a next step, the check's own is used: the command a contributor runs
# locally, or where to look. --next prints just that, for pr-blockers.sh.
#
# Writes a short block to $GITHUB_STEP_SUMMARY (when it is set):
#
#   ### <check> failed
#   **Why it failed:** <reason>
#   **What to do next:** <next step>
#
# and prints exactly one `::error title=Why it failed::<reason> Next: <next step>`
# line, which GitHub keeps as the check run's annotation. scripts/ship/pr-signal.sh
# reads that annotation back (the title is how it knows the line is this one) and
# puts the same reason and next step in the PR blockers comment, so the check page
# and the comment never say two different things.
#
# The reason and the next step are folded onto one line each. Nothing is read,
# nothing is written but the summary, and it exits 0 so the caller decides the
# check's own verdict. Exit 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,26p' "$0"; exit 0 ;; esac

# The next step for a check that did not name one.
next_for() {
  case "$1" in
    check) echo "run \`npm run check\` locally, fix what it reports, and push." ;;
    smoke) echo "open the red smoke-shard job for the failing test, run \`npm run smoke\` locally (or \`npx playwright test <spec>\` for that file), fix it, and push." ;;
    pr-video) echo "fix what the reason says and push, or mark the pull request ready again (or add the \`${SHIP_READY_LABEL:-ready}\` label) to have CI make the video; AGENTS.md, PR explainer videos." ;;
    ready-gate) echo "mark the pull request ready for review, or add the \`${SHIP_READY_LABEL:-ready}\` label, and let the Claude review pass; its comment says what it found." ;;
    'Claude review') echo "read the review comment, fix every BLOCKING finding, push, then add the \`${SHIP_READY_LABEL:-ready}\` label for a fresh review." ;;
    'PR video record' | 'PR video publish') echo "open the run and fix the cause, then add the \`${SHIP_READY_LABEL:-ready}\` label to make the video again." ;;
    *) echo "open the run, fix what it reports, and push." ;;
  esac
}
if [ "${1:-}" = --next ]; then
  [ $# -eq 2 ] || { echo "usage: check-summary.sh --next <check>" >&2; exit 2; }
  next_for "$2"
  exit 0
fi
[ $# -eq 2 ] || [ $# -eq 3 ] ||
  { echo "usage: check-summary.sh <check> <reason> [<next step>] (see --help)" >&2; exit 2; }

# One line, no doubled spaces: a reason a script built over several lines reads
# as one sentence here.
one_line() { printf '%s' "$1" | tr '\r\n\t' '   ' | tr -s ' ' | sed 's/^ //; s/ $//'; }
check="$(one_line "$1")"
reason="$(one_line "$2")"
next="$(one_line "${3:-$(next_for "$check")}")"
if [ -z "$check" ] || [ -z "$reason" ] || [ -z "$next" ]; then
  echo "usage: check-summary.sh <check> <reason> <next step>: none of them may be empty" >&2
  exit 2
fi

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### %s failed\n\n**Why it failed:** %s\n\n**What to do next:** %s\n' \
    "$check" "$reason" "$next" >>"$GITHUB_STEP_SUMMARY"
fi

# A workflow command's data ends at the line: % and the line breaks are escaped
# the way the runner reads them back.
escape() { local s="${1//%/%25}"; s="${s//$'\r'/%0D}"; printf '%s' "${s//$'\n'/%0A}"; }
printf '::error title=Why it failed::%s Next: %s\n' "$(escape "$reason")" "$(escape "$next")"

#!/usr/bin/env bash
# Advisory mutation testing. Stryker on the changed files in src/engine and
# src/game. The score goes to stdout and, when set, $GITHUB_STEP_SUMMARY.
# The run never fails: a crash, a timeout or a missing install still exits 0.
#
#   bash scripts/ship/mutate.sh <base> <head>
#
# The score is not a gate. CLAUDE.md: it becomes blocking after two weeks of
# usable scores, at a threshold chosen from that data.
set -u
case "${1:-}" in -h | --help) sed -n '2,10p' "$0"; exit 0 ;; esac

note() {
  printf '%s\n' "$1"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$1" >>"$GITHUB_STEP_SUMMARY"; fi
}

if [ $# -ne 2 ]; then
  note "Mutation testing (advisory): usage is mutate.sh <base> <head>"
  exit 0
fi
base="$1"
head="$2"

files="$(git diff --name-only "$base...$head" -- src/engine src/game 2>/dev/null || true)"
mutate=""
while read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    *.test.ts) continue ;;
    *.ts) ;;
    *) continue ;;
  esac
  if [ -n "$mutate" ]; then mutate="$mutate,$f"; else mutate="$f"; fi
done <<<"$files"

caveat() {
  note "On Vitest 5, @stryker-mutator/vitest-runner 10.0.0 mis-filters test names (https://github.com/stryker-mutator/stryker-js/issues/6210), so do not pick the blocking threshold from a score flagged by that bug."
}

if [ -z "$mutate" ]; then
  note "Mutation testing (advisory): no changed files in src/engine or src/game."
  caveat
  exit 0
fi

bin="node_modules/.bin/stryker"
if [ ! -x "$bin" ]; then
  note "Mutation testing (advisory): stryker is not installed; no score."
  caveat
  exit 0
fi

out="$(mktemp)"
# One vitest at a time (the config caps workers at 4). Stop after 12 minutes
# so the advisory job cannot hold the runner; an unfinished run is still a pass.
if command -v timeout >/dev/null 2>&1; then
  timeout 12m "$bin" run --mutate "$mutate" >"$out" 2>&1 || true
else
  "$bin" run --mutate "$mutate" >"$out" 2>&1 || true
fi

score="$(awk '/Mutation score|All files/ { print; n++; if (n == 5) exit }' "$out")"
if [ -z "$score" ]; then score="no score in the Stryker output"; fi
# Vitest 5 joins test names with " > ". Stryker's vitest runner 10.0.0 still
# joins them with a space, so per-test filtering matches nothing and covered
# mutants are reported as survived (stryker-js#6210). The number is not usable
# as a gate until that fix is in a run.
note "Mutation testing (advisory):"
note "$score"
note "Advisory only: this does not fail the build."
caveat
rm -f "$out"
exit 0

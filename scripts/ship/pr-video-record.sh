#!/usr/bin/env bash
# Film the explainer walkthrough. This is job 1 of two, and it is the one that
# runs the pull request's own code — so it holds no secret of any kind. All it
# produces is a silent recording and the two facts job 2 needs to find the pull
# request again (AGENTS.md "PR explainer videos").
#
#   PR_NUMBER=51 PR_TITLE='...' PR_BODY='...' BASE=<sha> HEAD=<sha> \
#     bash scripts/ship/pr-video-record.sh [outdir]
#   BASE=<sha> HEAD=<sha> bash scripts/ship/pr-video-record.sh --plan
#     (the files the diff touches and the walkthrough it would film; films nothing)
#
# outdir (default pr-video) ends up holding:
#   meta.json   {"pr":51,"sha":"<head>"} — job 2 checks both against the API
#   clips/*.webm  one recording per size
# Nothing is narrated, muxed or uploaded here: that is job 2, which never runs
# a line of this pull request.
#
# A walkthrough that cannot follow the pull request's steps still records (the
# spec swallows those), so this script fails only when Playwright itself could
# not run at all, or when it cannot tell which files the pull request touches:
# that is what picks the walkthrough, and filming a guess would hide it. Exit 0
# on success, 1 when there is no recording or no file list, 2 on usage.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,22p' "$0"; exit 0 ;; esac
[ $# -le 1 ] || { echo "usage: pr-video-record.sh [outdir] | --plan (see --help)" >&2; exit 2; }
plan=0
[ "${1:-}" != --plan ] || plan=1
out="${1:-pr-video}"
# Playwright is given an absolute output directory, so a relative argument is
# resolved here rather than glued onto $PWD after the fact.
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
if [ "$plan" = 0 ]; then
  [ -n "${PR_NUMBER:-}" ] || { echo "PR_NUMBER is not set" >&2; exit 2; }
  case "$PR_NUMBER" in '' | *[!0-9]*) echo "PR_NUMBER must be a pull request number" >&2; exit 2 ;; esac
fi
[ -n "${HEAD:-}" ] || { echo "HEAD is not set" >&2; exit 2; }
# A commit, so the JSON below can be printed rather than built: the Playwright
# container carries no jq, the same reason ci.yml's flaky job runs on the runner.
case "$HEAD" in *[!0-9a-f]*) echo "HEAD must be a commit sha" >&2; exit 2 ;; esac
[ -n "${BASE:-}" ] || { echo "BASE is not set" >&2; exit 2; }
case "$BASE" in *[!0-9a-f]*) echo "BASE must be a commit sha" >&2; exit 2 ;; esac

# This job is handed the pull request's code. Nothing it runs may see a key,
# and nothing it writes may carry one.
unset ANTHROPIC_API_KEY OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN

if [ "$plan" = 0 ]; then
  rm -rf "$out"
  mkdir -p "$out/clips"
  printf '{"pr":%s,"sha":"%s"}\n' "$PR_NUMBER" "$HEAD" >"$out/meta.json"
fi

# The job runs as root inside the Playwright container, on a checkout the
# runner's user owns, and git refuses such a repository outright ("detected
# dubious ownership"): every command below failed there, quietly, and every
# pull request was filmed without its file list (PR 62, run 40452944041). The
# exception is scoped to this process and this checkout; no git config file is
# written.
export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.directory GIT_CONFIG_VALUE_0="$PWD"

# What the diff touches, which picks the walkthrough. The checkout is the head,
# and the base commit is not always in it, so fetch it when it is missing.
if ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
  err="$(git fetch --no-tags origin "$BASE" 2>&1 >/dev/null)" || true
  if ! git cat-file -e "$BASE^{commit}" 2>/dev/null; then
    echo "::error::record: cannot reach the base $BASE, so there is no file list to pick the walkthrough by: ${err:-the fetch brought no such commit}" >&2
    exit 1
  fi
fi
# From where the pull request branched, not from the base's tip: BASE is main
# as it is now, so a two-dot diff of an older, un-rebased pull request would
# list every file main has changed since, as if the pull request had.
if ! fork="$(git merge-base "$BASE" "$HEAD" 2>&1)"; then
  echo "::error::record: cannot find where this pull request branched from $BASE: $fork" >&2
  exit 1
fi
if ! files="$(git diff --no-renames --name-only "$fork" "$HEAD" 2>&1)"; then
  echo "::error::record: cannot list the files this pull request touches: $files" >&2
  exit 1
fi
echo "record: the diff touches $(grep -c . <<<"$files" || true) file(s) since ${fork:0:7}"
if [ "$plan" = 1 ]; then
  while IFS= read -r f; do [ -z "$f" ] || echo "record: touches $f"; done <<<"$files"
fi

specs=()
custom=()
for spec in e2e/walkthroughs/*.spec.ts; do
  [ -e "$spec" ] || continue
  case "$spec" in
    e2e/walkthroughs/default.spec.ts) ;;
    *) custom+=("$spec") ;;
  esac
done
# A pull request that checked in its own walkthrough gets that one filmed
# instead of the generic one.
if [ "${#custom[@]}" -gt 0 ]; then
  specs=("${custom[@]}")
  echo "record: filming this pull request's own walkthrough (${custom[*]})"
else
  specs=(e2e/walkthroughs/default.spec.ts)
fi

[ "$plan" = 0 ] || exit 0

status=0
PR_TITLE="${PR_TITLE:-}" PR_BODY="${PR_BODY:-}" PR_FILES="$files" \
  VIDEO_OUT="$out/clips" \
  npx playwright test -c e2e/walkthroughs/playwright.config.ts "${specs[@]}" || status=$?
[ "$status" = 0 ] || echo "record: the walkthrough run ended $status; keeping whatever it filmed" >&2

# Playwright leaves one video per test in a directory of its own. Flatten them,
# newest last, so the join keeps a stable order.
n=0
while IFS= read -r clip; do
  [ -n "$clip" ] || continue
  n=$((n + 1))
  mv "$clip" "$out/clips/$(printf '%02d' "$n").webm"
done < <(find "$out/clips" -name '*.webm' -type f | LC_ALL=C sort)
find "$out/clips" -mindepth 1 -type d -exec rm -rf {} + 2>/dev/null || true

if [ "$n" = 0 ]; then
  echo "record: the walkthrough left no recording" >&2
  exit 1
fi
echo "record: $n clip(s) in $out/clips"

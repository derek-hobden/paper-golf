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

# A checked-in walkthrough is filmed only for the pull request that adds it: its
# spec is not there where the pull request branched. Touching a file a spec
# names (its `// walkthrough-covers:` lines) is not enough: those are often
# shared helpers, and PR 97, which changed the review sentence in
# review-first-scenes.ts, was filmed with PR 73's walkthrough over its own
# narration. Every other pull request gets the generic walkthrough, so a spec
# that lands on main never takes over the videos of the pull requests after it.
# The line says which film was chosen, and why.
added() { ! git cat-file -e "$fork:$1" 2>/dev/null && grep -qxF -- "$1" <<<"$files"; }
specs=()
for spec in e2e/walkthroughs/*.spec.ts; do
  [ -e "$spec" ] || continue
  [ "$spec" != e2e/walkthroughs/default.spec.ts ] || continue
  if added "$spec"; then
    specs+=("$spec")
    echo "record: filming $spec (this pull request adds it)"
  elif grep -qxF -- "$spec" <<<"$files"; then
    echo "record: not filming $spec: main already has it, so it is an earlier pull request's walkthrough"
  fi
done
if [ "${#specs[@]}" = 0 ]; then
  specs=(e2e/walkthroughs/default.spec.ts)
  echo "record: this pull request adds no walkthrough; filming the generic walkthrough (${specs[0]})"
fi

# The scenes have to be this pull request's. A checked-in walkthrough shows
# words its `## How to see it` steps quote ("..."), and the narration says them,
# so every quoted phrase in the steps has to be in the walkthrough's own files:
# the spec and the files its `// walkthrough-covers:` lines name. Steps that
# quote nothing, or quote words the walkthrough does not have, mean the film is
# someone else's, and no video is made from it. The generic walkthrough films
# the steps themselves and needs no such check.
scene_check() {
  local steps quoted phrase missing='' f
  local -a sources=()
  for spec in "${specs[@]}"; do
    sources+=("$spec")
    while IFS= read -r f; do
      [ -z "$f" ] || [ ! -f "$f" ] || sources+=("$f")
    done < <(sed -n 's#^// walkthrough-covers: *\([^ ]*\) *$#\1#p' "$spec")
  done
  steps="$(printf '%s\n' "${PR_BODY:-}" | awk '
    tolower($0) ~ /^#+[[:space:]]*how to see it[[:space:]]*$/ { inside = 1; next }
    /^#+[[:space:]]/ { inside = 0 }
    inside { print }')"
  quoted="$(grep -o '"[^"]*"' <<<"$steps" | sed 's/^"//; s/"$//' | sed '/^$/d' || true)"
  if [ -z "$quoted" ]; then
    echo "::error::record: ${specs[*]} is a checked-in walkthrough, but this pull request's ## How to see it quotes none of its scene text, so the film would not be this pull request's" >&2
    return 1
  fi
  # Evidence that runs a test has to be this pull request's own proof, and say
  # what it proves (Gus on pr-98-8de94ab.mp4: ci_claude_review_on_every_pr, an
  # older feature's test, played under "the review test pins Claude Opus 5.5",
  # and nothing it showed was said). A `test <case>` case has to be one this
  # pull request adds, it has to name a file the pull request changes outside
  # the tests, and the `proves "..."` lines it prints have to be quoted in the
  # steps, so the narration says what the clip shows.
  local case body proved='' changed bad=''
  changed="$(grep -vE '^(tests/|e2e/|scripts/ship/test-ship\.sh$|scripts/ship/test-fakes/)' <<<"$files" || true)"
  while IFS= read -r case; do
    [ -n "$case" ] || continue
    if git show "$fork:scripts/ship/test-ship.sh" 2>/dev/null | grep -q "^t_${case}() {"; then
      bad="$bad
  test $case is an older test (main already has it): evidence has to be a test this pull request adds"
      continue
    fi
    body="$(awk -v f="t_${case}() {" '$0 == f { on = 1 } on { print } on && /^}$/ { exit }' scripts/ship/test-ship.sh)"
    if [ -z "$body" ]; then
      bad="$bad
  test $case is not a case in scripts/ship/test-ship.sh"
      continue
    fi
    local names=0 f
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      if grep -qF -- "$(basename "$f")" <<<"$body"; then names=1; break; fi
    done <<<"$changed"
    [ "$names" = 1 ] || bad="$bad
  test $case names no file this pull request changes outside the tests, so it cannot cover the lines it changed"
    local says
    says="$(sed -n 's/^[[:space:]]*proves "\([^"]*\)"[[:space:]]*$/\1/p' <<<"$body")"
    if [ -z "$says" ]; then
      bad="$bad
  test $case prints no proves \"...\" line, so the clip would show nothing the narration says"
      continue
    fi
    while IFS= read -r phrase; do
      grep -qxF -- "$phrase" <<<"$quoted" || bad="$bad
  test $case proves \"$phrase\", and the ## How to see it steps never quote it, so the narration would not say it"
    done <<<"$says"
    proved="$proved$says"$'\n'
  done < <(sed -n 's#^// walkthrough-evidence: .* | test \([a-z0-9_]*\) *$#\1#p' "${specs[@]}")
  if [ -n "$bad" ]; then
    echo "::error::record: ${specs[*]} shows evidence that is not this pull request's own, said proof:$bad" >&2
    return 1
  fi
  while IFS= read -r phrase; do
    grep -qF -- "$phrase" "${sources[@]}" || grep -qxF -- "$phrase" <<<"$proved" || missing="$missing
  \"$phrase\""
  done <<<"$quoted"
  if [ -n "$missing" ]; then
    echo "::error::record: the ## How to see it steps quote words that ${specs[*]} does not show:$missing" >&2
    return 1
  fi
  echo "record: every phrase the steps quote is in ${sources[*]}"
}
if [ "${specs[0]}" != e2e/walkthroughs/default.spec.ts ]; then
  if [ "$plan" = 1 ] && [ -z "${PR_BODY:-}" ]; then
    echo "record: scene check skipped: no PR_BODY to read the ## How to see it steps from (a recording without one fails)"
  else
    scene_check || exit 1
  fi
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

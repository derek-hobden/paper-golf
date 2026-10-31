#!/usr/bin/env bash
# The explainer video for a dependency update: a pull request a dependency bot
# opened (lib.sh SHIP_DEPENDENCY_BOTS: dependabot[bot], renovate[bot]). Those
# buy no Claude review and write no `## How to see it` steps, so the review path
# (pr-video-record.yml, which films a pull request's own build once its review
# passes) never makes their video — and the pr-video check fails closed without
# one (Derek, 31 Oct 2026). This is their path, and every line of it is main's
# copy: .github/workflows/pr-video-deps.yml runs on workflow_run of CI, checks
# out the default branch, and reads the pull request only through the API, as
# data. Nothing from the head is checked out, built or run.
#
#   GH_TOKEN=<read-only> SHIP_REPO=<owner/repo> RUN_ID=<CI run> RUN_HEAD_SHA=<sha> \
#   RUN_EVENT=pull_request RUN_CONCLUSION=success RUN_HEAD_REPO=<owner/repo> [RUN_PR=<n>] \
#     bash scripts/ship/pr-video-deps.sh decide <outdir>
#   GH_TOKEN=<read-only> SHIP_REPO=<owner/repo> PR=<n> RUN_HEAD_SHA=<sha> CI_RUN_ID=<CI run> \
#     bash scripts/ship/pr-video-deps.sh prove <outdir>
#   bash scripts/ship/pr-video-deps.sh film <outdir>
#
# decide: does this CI run earn a dependency video? Only a green pull_request
# run of this repository (decided before any read), whose pull request a
# dependency bot opened, open, not a draft, its head still the run's head, and
# whose body does not already open with a video that stands for that head (the
# head's own pr-<n>-<sha7>.mp4, or one only docs-only commits and clean merges
# of main have followed: review-state.sh covers, through the API). Doubt about
# that last makes the video: the gate fails closed without one. Prints, and
# appends to $GITHUB_OUTPUT, `make=yes|no`, `reason=`, `pr=` and `sha=`; on yes
# it leaves <outdir>/facts.json (what the film draws) and <outdir>/meta.json
# ({"pr":<n>,"sha":"<head>"}, which the make job checks against the API).
#
# prove: the make job's check, against the API and never the artifact, before
# anything is bought: the pull request is a dependency bot's, open, not a draft,
# of this repository, at RUN_HEAD_SHA, and CI_RUN_ID is a completed, green
# ci.yml run of the pull_request event at that sha whose check and smoke jobs
# all passed. It leaves <outdir>/counts — review_run=ci-run-<id> (the one-video
# cap's key), updates=, other= and checks= (the numbers the narration's fixed
# last paragraph is built from) — and exits 1, with nothing written, on any
# doubt.
#
# film: films facts.json with main's own walkthrough
# (e2e/walkthroughs/deps/dependency-update.spec.ts, its own Playwright config:
# desktop size, no server, no build) into <outdir>/clips, and leaves the scene
# starts (beats.json) and the narration's spec and steps (story.md) beside it.
# Every key and token is unset first.
#
# The facts: the updates (name, from, to) from package.json lines and workflow
# `uses:` pins, else Dependabot's "Bump X from A to B" title — every name and
# version held to a safe set of characters, anything else dropped, at most
# MAX_SHOWN drawn and the rest counted; how many changed files are dependency
# files (package.json, package-lock.json, .github/dependabot.yml, a workflow
# whose every changed line is a `uses:` pin) and how many are not; the CI run's
# check and smoke jobs with their conclusions and seconds (the evidence after);
# and main's own CI run for the base commit (the evidence before). Reads only:
# nothing is written to GitHub.
#
# Exit 0 with an answer, 1 when the pull request cannot be read or proved, 2 on
# a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,${/^[^#]/q;p;}' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

# The most updates the film draws; the rest are a count.
MAX_SHOWN=8

usage() {
  echo "usage: pr-video-deps.sh decide|prove|film <outdir> (see --help)" >&2
  exit 2
}
[ $# -eq 2 ] && [ -n "$2" ] || usage
mode="$1"
out="$2"
case "$mode" in decide | prove | film) ;; *) usage ;; esac

# --- film: main's walkthrough, on main's code, with no key in reach ----------
if [ "$mode" = film ]; then
  unset ANTHROPIC_API_KEY OPENROUTER_API_KEY GH_TOKEN GITHUB_TOKEN
  case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
  [ -f "$out/facts.json" ] || { echo "::error::no facts.json in $out" >&2; exit 1; }
  rm -rf "$out/clips"
  mkdir -p "$out/clips"
  FACTS_FILE="$out/facts.json" VIDEO_OUT="$out/clips" \
    npx playwright test -c e2e/walkthroughs/deps/playwright.config.ts
  n=0
  while IFS= read -r clip; do
    [ -n "$clip" ] || continue
    n=$((n + 1))
    mv "$clip" "$out/clips/$(printf '%02d' "$n").webm"
  done < <(find "$out/clips" -name '*.webm' -type f | LC_ALL=C sort)
  find "$out/clips" -mindepth 1 -type d -exec rm -rf {} + 2>/dev/null || true
  rm -f "$out/clips/.last-run.json"
  [ "$n" = 1 ] || { echo "::error::the film left $n recordings, not one" >&2; exit 1; }
  [ -s "$out/beats.json" ] && [ -s "$out/story.md" ] ||
    { echo "::error::the film left no beats.json or story.md" >&2; exit 1; }
  echo "film: 1 clip, $(tr -cd ',' <"$out/beats.json" | wc -c | tr -d ' ') scene changes, in $out"
  exit 0
fi

ship_need gh jq
[ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }
[[ "${RUN_HEAD_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "::error::RUN_HEAD_SHA must be a full commit sha" >&2; exit 2; }
head="$RUN_HEAD_SHA"

# read_pr <n>: the pull request's fields, as data.
read_pr() {
  local json row
  json="$(gh api "/repos/$SHIP_REPO/pulls/$1")" || return 1
  row="$(jq -r '[(.user.login // ""), (.state // ""), (.draft | tostring), (.head.sha // ""),
    (.head.repo.full_name // ""), (.base.sha // ""), (.base.ref // "")] | @tsv' <<<"$json")" || return 1
  IFS=$'\t' read -r pr_author pr_state pr_draft pr_head pr_head_repo pr_base pr_base_ref <<<"$row"
  pr_title="$(jq -r '.title // ""' <<<"$json")" || return 1
  pr_body="$(jq -r '.body // ""' <<<"$json")" || return 1
}

# pr_problem <n>: why this pull request is not a dependency update at the head, or nothing.
pr_problem() {
  if ! ship_is_dependency_bot "$pr_author"; then
    echo "pull request $1 is by ${pr_author:-nobody}, not a dependency bot: its video is made after its Claude review passes (pr-video-record.yml)"
  elif [ "$pr_state" != open ]; then
    echo "pull request $1 is $pr_state"
  elif [ "$pr_draft" = true ]; then
    echo "pull request $1 is a draft"
  elif [ "$pr_head_repo" != "$SHIP_REPO" ]; then
    echo "pull request $1 is from $pr_head_repo, not $SHIP_REPO"
  elif [ "$pr_head" != "$head" ]; then
    echo "this run is for ${head:0:7}, and the head is now ${pr_head:0:7}: the newest run decides"
  fi
}

# facts <pr> <ci run> <file>: what the film draws and the narration counts.
facts() {
  local pr="$1" run="$2" file="$3" files jobs main
  files="$(gh api --paginate "/repos/$SHIP_REPO/pulls/$pr/files?per_page=100" \
    --jq '.[] | {filename: (.filename // ""), patch: (.patch // "")}')" || return 1
  jobs="$(gh api --paginate "/repos/$SHIP_REPO/actions/runs/$run/jobs?per_page=100" \
    --jq '.jobs[] | {name: (.name // ""), conclusion: (.conclusion // ""), started_at, completed_at}')" || return 1
  # Main as it was before: its own CI run of the base commit. None found is said, not guessed.
  main="$(gh api "/repos/$SHIP_REPO/actions/workflows/ci.yml/runs?branch=main&head_sha=$pr_base&per_page=10" \
    --jq '[.workflow_runs[]? | select(.status == "completed")][0] // empty | {conclusion: (.conclusion // "")}' 2>/dev/null)" ||
    main=''
  jq -n --argjson pr "$pr" --arg sha "$head" --arg base "$pr_base" --arg author "$pr_author" --argjson run "$run" \
    --arg title "$pr_title" --argjson max "$MAX_SHOWN" \
    --argjson files "$(jq -sc . <<<"$files")" --argjson jobs "$(jq -sc . <<<"$jobs")" \
    --argjson main "$(jq -sc '.[0] // null' <<<"$main")" '
    def safe_name: test("^[@A-Za-z0-9._/-]{1,80}$");
    def safe_version: test("^[A-Za-z0-9.^~<>=+_-]{1,40}$");
    def changed: [(.patch // "") | split("\n")[] | select(test("^[-+]") and (test("^(\\+\\+\\+|---)") | not))];
    def is_package: .filename == "package.json" or (.filename | endswith("/package.json"));
    def is_workflow: .filename | test("^\\.github/workflows/[^/]+\\.ya?ml$");
    def pin_only: (changed | length) > 0 and (changed | all(test("^[-+]\\s*(-\\s*)?uses:\\s")));
    def dependency_file:
      is_package or .filename == "package-lock.json" or (.filename | endswith("/package-lock.json"))
      or .filename == ".github/dependabot.yml" or .filename == ".github/dependabot.yaml"
      or (is_workflow and pin_only);
    def npm_side($sign):
      [changed[] | select(startswith($sign))
        | capture("^[-+]\\s*\"(?<name>[^\"]+)\"\\s*:\\s*\"(?<v>[^\"]+)\"")?];
    def pin_side($sign):
      [changed[] | select(startswith($sign))
        | capture("^[-+]\\s*(-\\s*)?uses:\\s*(?<name>[^@\\s]+)@(?<ref>\\S+)(\\s*#\\s*(?<tag>\\S+))?")?
        | {name, v: (.tag // .ref[0:7])}];
    def pairs($old; $new):
      [$old[] as $o | $new[] | select(.name == $o.name and .v != $o.v) | {name, from: $o.v, to: .v}];
    def safe: select((.name | safe_name) and (.from | safe_version) and (.to | safe_version));
    ([$files[] | select(is_package) | pairs(npm_side("-"); npm_side("+"))[]]
      + [$files[] | select(is_workflow) | pairs(pin_side("-"); pin_side("+"))[]]
      | map(safe) | unique_by(.name)) as $found
    | (if ($found | length) > 0 then $found
       else [$title | capture("^[Bb]ump (?<name>\\S+) from (?<from>\\S+) to (?<to>\\S+?)\\.?$")? | safe]
       end) as $updates
    | {pr: $pr, sha: $sha, base: $base, author: $author, ci_run: $run,
       updates: $updates[0:$max], more: ([($updates | length) - $max, 0] | max),
       dependency_files: ([$files[] | select(dependency_file)] | length),
       other_files: ([$files[] | select(dependency_file | not)] | length),
       checks: [$jobs[] | select(.name == "check" or .name == "smoke" or (.name | startswith("smoke-shard")))
         | {name, conclusion,
            seconds: (if .started_at and .completed_at
              then ((.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601)) else 0 end)}],
       main: (if $main == null then null else {sha: $base[0:7], conclusion: $main.conclusion} end)}' >"$file"
}

# --- decide -------------------------------------------------------------------
if [ "$mode" = decide ]; then
  # answer <yes|no> <reason>: the decision, on stdout and $GITHUB_OUTPUT.
  answer() {
    local lines
    lines="$(printf 'make=%s\nreason=%s\npr=%s\nsha=%s' "$1" "$2" "${pr:-}" "$head")"
    printf '%s\n' "$lines"
    [ -z "${GITHUB_OUTPUT:-}" ] || printf '%s\n' "$lines" >>"$GITHUB_OUTPUT"
    exit 0
  }
  pr=''
  # Before any read: only a green pull_request run of this repository.
  [ "${RUN_EVENT:-}" = pull_request ] || answer no "this CI run is a ${RUN_EVENT:-unknown} run, not a pull request's"
  [ "${RUN_CONCLUSION:-}" = success ] || answer no "this CI run is ${RUN_CONCLUSION:-unfinished}: a video shows the checks passing"
  [ "${RUN_HEAD_REPO:-}" = "$SHIP_REPO" ] || answer no "this CI run is for ${RUN_HEAD_REPO:-an unknown repository}, not $SHIP_REPO"
  [[ "${RUN_ID:-}" =~ ^[0-9]+$ ]] || { echo "::error::RUN_ID must be the CI run's id" >&2; exit 2; }
  pr="${RUN_PR:-}"
  if ! [[ "$pr" =~ ^[0-9]+$ ]]; then
    pr="$(gh api "/repos/$SHIP_REPO/commits/$head/pulls" \
      --jq "[.[] | select(.state == \"open\" and .head.sha == \"$head\")][0].number // empty")" || {
      echo "::error::cannot list the pull requests of ${head:0:7}" >&2
      exit 1
    }
    [ -n "$pr" ] || answer no "no open pull request has ${head:0:7} as its head"
  fi
  read_pr "$pr" || { echo "::error::cannot read pull request $pr" >&2; exit 1; }
  why="$(pr_problem "$pr")"
  [ -z "$why" ] || answer no "$why"
  # One video per head: the one on top may still stand for it.
  link="$(ship_video_body_link "$pr_body")"
  if [[ "$link" =~ $(ship_video_link_re "$SHIP_REPO") ]] && [[ "${link##*/}" =~ ^pr-([0-9]+)-([0-9a-f]{7})[.]mp4$ ]] &&
    [ "${BASH_REMATCH[1]}" = "$pr" ]; then
    v7="${BASH_REMATCH[2]}"
    [ "$v7" != "${head:0:7}" ] || answer no "the body already opens with the video of this head"
    v="$(gh api "/repos/$SHIP_REPO/commits/$v7" --jq '.sha' 2>/dev/null || true)"
    if [[ "$v" =~ ^[0-9a-f]{40}$ ]]; then
      rc=0
      stale="$(bash "$here/review-state.sh" covers "$v" "$head" "${pr_base_ref:-main}" 2>/dev/null)" || rc=$?
      [ "$rc" != 0 ] || answer no "the video of $v7 on top still stands for the head: only docs-only commits and clean merges of main since"
      echo "decide: the video of $v7 does not stand for ${head:0:7}${stale:+: $stale}"
    else
      echo "decide: cannot place the video's commit $v7, so a new video is made (the gate fails closed without one)"
    fi
  fi
  mkdir -p "$out"
  facts "$pr" "$RUN_ID" "$out/facts.json" || { echo "::error::cannot read the facts of pull request $pr" >&2; exit 1; }
  jq -nc --argjson pr "$pr" --arg sha "$head" '{pr: $pr, sha: $sha}' >"$out/meta.json"
  answer yes "a green CI run of $pr_author's pull request $pr at ${head:0:7}, with no video that stands for it"
fi

# --- prove --------------------------------------------------------------------
case "${PR:-}" in '' | *[!0-9]*) echo "::error::PR must be a pull request number" >&2; exit 2 ;; esac
[[ "${CI_RUN_ID:-}" =~ ^[0-9]+$ ]] || { echo "::error::CI_RUN_ID must be the CI run's id" >&2; exit 2; }
fail_proof() {
  echo "::error::no video: $*" >&2
  exit 1
}
read_pr "$PR" || fail_proof "cannot read pull request $PR"
why="$(pr_problem "$PR")"
[ -z "$why" ] || fail_proof "$why"
run_row="$(gh api "/repos/$SHIP_REPO/actions/runs/$CI_RUN_ID" --jq '[(.path // ""), (.event // ""), (.status // ""),
  (.conclusion // ""), (.head_sha // ""), (.head_repository.full_name // "")] | @tsv')" ||
  fail_proof "cannot read CI run $CI_RUN_ID"
IFS=$'\t' read -r run_path run_event run_status run_conclusion run_sha run_repo <<<"$run_row"
[ "$run_path" = .github/workflows/ci.yml ] || fail_proof "run $CI_RUN_ID is ${run_path:-no workflow}, not ci.yml"
[ "$run_event" = pull_request ] || fail_proof "run $CI_RUN_ID is a ${run_event:-unknown} run, not a pull request's"
[ "$run_status" = completed ] && [ "$run_conclusion" = success ] ||
  fail_proof "run $CI_RUN_ID is ${run_status:-?}/${run_conclusion:-?}, not a green CI run"
[ "$run_sha" = "$head" ] || fail_proof "run $CI_RUN_ID tested ${run_sha:0:7}, not the head ${head:0:7}"
[ "$run_repo" = "$SHIP_REPO" ] || fail_proof "run $CI_RUN_ID is for $run_repo, not $SHIP_REPO"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
facts "$PR" "$CI_RUN_ID" "$work/facts.json" || fail_proof "cannot read the facts of pull request $PR"
counts="$(jq -r '
  if ([.checks[] | select(.name == "check")] | length) == 0 or ([.checks[] | select(.name == "smoke")] | length) == 0
  then "no check or smoke job"
  elif ([.checks[] | select(.conclusion != "success")] | length) > 0
  then "a check or smoke job did not pass: " + ([.checks[] | select(.conclusion != "success") | .name] | join(", "))
  else "updates=\((.updates | length) + .more)\nother=\(.other_files)\nchecks=\(.checks | length)" end' "$work/facts.json")"
case "$counts" in updates=*) ;; *) fail_proof "run $CI_RUN_ID: $counts" ;; esac
mkdir -p "$out"
printf 'review_run=ci-run-%s\n%s\n' "$CI_RUN_ID" "$counts" >"$out/counts"
echo "pr-video-deps: proved pull request $PR at ${head:0:7} by CI run $CI_RUN_ID"
cat "$out/counts"

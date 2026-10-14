#!/usr/bin/env bash
# Tests for scripts/ship/wait-for-next-stage.sh and mirror-to-github.sh, with
# fake gh / curl and a git wrapper on PATH (scripts/ship/test-fakes) and temp
# fixture repos. No network, nothing outside the temp dir changes.
#
#   bash scripts/ship/test-ship.sh            # all cases (npm run test:ship)
#   bash scripts/ship/test-ship.sh <case>     # one case (tests/ship.test.ts)
#   bash scripts/ship/test-ship.sh --list     # case names
set -euo pipefail
# Nothing here reads input; an inherited open stdin (vitest, background shells)
# can make wrapped tools wait on it.
exec </dev/null
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAIT="$dir/wait-for-next-stage.sh"
MIRROR="$dir/mirror-to-github.sh"
ORIG_PATH="$PATH"
# Fixture setup and assertions use git without the fakes (not logged, real push).
real_git() { PATH="$ORIG_PATH" git "$@"; }
TMP_ROOT="$(cd "$dir/../.." && pwd)/node_modules/.cache/pg-ship-test"
SHA=0123456789abcdef0123456789abcdef01234567

fail() {
  echo "FAIL: $*" >&2
  echo "--- output:" >&2
  printf '%s\n' "${out:-}" >&2
  exit 1
}
has() { case "$out" in *"$1"*) ;; *) fail "expected output to contain: $1" ;; esac; }
hasnt() { case "$out" in *"$1"*) fail "expected output not to contain: $1" ;; *) ;; esac; }
logged() { grep -qF -- "$1" "$FAKE_LOG" || fail "expected a logged call: $1"; }
not_logged() { if grep -qF -- "$1" "$FAKE_LOG"; then fail "unexpected logged call: $1"; fi; }

# Fresh temp dir with fake binaries first on PATH.
setup() {
  # Fixtures live inside the repo (gitignored node_modules/.cache), not $TMPDIR:
  # bot job hosts only allow git on paths inside their workspace.
  mkdir -p "$TMP_ROOT"
  T="$(mktemp -d "$TMP_ROOT/case.XXXXXX")"
  export FAKE_LOG="$T/calls.log" FAKE_STATE="$T/state"
  mkdir -p "$FAKE_STATE"
  : >"$FAKE_LOG"
  export PATH="$dir/test-fakes:$PATH"
  unset VERCEL_TOKEN FAKE_GH_AUTH FAKE_GH_VIS FAKE_GH_PROTOCOL FAKE_CURL_FAIL
  export FAKE_CI_JSON="$T/ci.json" FAKE_VERCEL_DEPLOYMENTS="$T/deployments.json" FAKE_VERCEL_PROJECT="$T/project.json"
  echo '{"workflow_runs":[]}' >"$FAKE_CI_JSON"
  echo '{"deployments":[]}' >"$FAKE_VERCEL_DEPLOYMENTS"
  echo '{"id":"prj"}' >"$FAKE_VERCEL_PROJECT"
  export WAIT_INTERVAL_S=0 WAIT_TIMEOUT_S=0
}

ci() { printf '{"workflow_runs":[{"status":"%s","conclusion":%s}]}\n' "$1" "$2" >"${3:-$FAKE_CI_JSON}"; }
# deploy <target|null> <STATE> [sha] ...: one deployment per triple.
deploy() {
  local items='' sep=''
  while [ $# -gt 0 ]; do
    items="$items$sep{\"target\":$1,\"state\":\"$2\",\"meta\":{\"githubCommitSha\":\"$3\"}}"
    sep=,
    shift 3
  done
  echo "{\"deployments\":[$items]}" >"$FAKE_VERCEL_DEPLOYMENTS"
}
run() {
  status=0
  out="$("$@" 2>&1)" || status=$?
}

# --- wait-for-next-stage.sh ---------------------------------------------------

t_wait_help() { run bash "$WAIT" --help; [ "$status" = 0 ] || fail "status $status"; has "--from <stage>"; }
t_wait_bad_sha() { run bash "$WAIT" 'main;rm'; [ "$status" = 1 ] || fail "status $status"; has "not a commit sha"; }
t_wait_pushed() {
  run bash "$WAIT" "$SHA"
  has "stage: pushed"; has "vercel: vercel stage unknown (VERCEL_TOKEN not set)"
  has "next: bash scripts/ship/wait-for-next-stage.sh $SHA --from pushed"
  logged "head_sha=$SHA"
}
t_wait_ci_running() { ci in_progress null; run bash "$WAIT" "$SHA"; has "ci: ci-running"; has "stage: ci-running"; }
t_wait_ci_green() { ci completed '"success"'; run bash "$WAIT" "$SHA"; has "stage: ci-green"; }
t_wait_ci_red() { ci completed '"failure"'; run bash "$WAIT" "$SHA"; has "stage: ci-red"; hasnt "next:"; }
t_wait_preview_building() {
  export VERCEL_TOKEN=test-token-123
  ci completed '"success"'; deploy null BUILDING "$SHA"
  run bash "$WAIT" "$SHA"; has "ci: ci-green"; has "vercel: preview-building"; has "stage: preview-building"
}
t_wait_preview_ready() {
  export VERCEL_TOKEN=test-token-123
  deploy null READY "$SHA" null ERROR "$SHA"
  run bash "$WAIT" "$SHA"; has "stage: preview-ready"; has "--from preview-ready"
}
t_wait_production_skipped() {
  export VERCEL_TOKEN=test-token-123
  ci completed '"success"'; deploy '"production"' CANCELED "$SHA"
  run bash "$WAIT" "$SHA"; has "stage: production-skipped"; hasnt "production-error"; hasnt "next:"
}
t_wait_preview_error() { export VERCEL_TOKEN=test-token-123; deploy null ERROR "$SHA"; run bash "$WAIT" "$SHA"; has "stage: preview-error"; }
t_wait_production_needs_ready() {
  export VERCEL_TOKEN=test-token-123
  deploy null READY "$SHA" '"production"' BUILDING "$SHA"
  run bash "$WAIT" "$SHA"; has "stage: production-building"; hasnt "production-ready"
}
t_wait_production_ready() {
  export VERCEL_TOKEN=test-token-123
  deploy null READY "$SHA" '"production"' READY "$SHA"
  run bash "$WAIT" "$SHA"; has "stage: production-ready"; hasnt "next:"
  logged "projectId=prj_2wXuwwaoThxXs8GAfBfcreeFeWO0&teamId=team_NOIeemLqazmSprS9Y1tgjYx1&sha=$SHA"
}
t_wait_other_sha_ignored() {
  export VERCEL_TOKEN=test-token-123
  ci in_progress null; deploy '"production"' READY ffffffffffffffffffffffffffffffffffffffff
  run bash "$WAIT" "$SHA"; has "vercel: none"; has "stage: ci-running"
}
t_wait_api_error() {
  export VERCEL_TOKEN=test-token-123 FAKE_CURL_FAIL=1
  ci completed '"success"'
  run bash "$WAIT" "$SHA"; [ "$status" = 0 ] || fail "status $status"
  has "vercel stage unknown (API error)"; has "stage: ci-green"
}
t_wait_token_never_in_argv_or_output() {
  export VERCEL_TOKEN=secret-token-xyz
  deploy null READY "$SHA"
  run bash "$WAIT" "$SHA"; has "stage: preview-ready"; hasnt "secret-token-xyz"
  not_logged "secret-token-xyz"; logged "curl -sf --max-time 20 -K -"
}
t_wait_from_changes() {
  ci in_progress null; ci in_progress null "$FAKE_CI_JSON.1"; ci completed '"success"' "$FAKE_CI_JSON.2"
  export WAIT_TIMEOUT_S=60
  run bash "$WAIT" "$SHA" --from ci-running; has "stage: ci-green"; hasnt "no change yet"
  [ "$(cat "$FAKE_STATE/api-calls")" = 2 ] || fail "expected 2 polls"
}
t_wait_from_timeout() {
  ci in_progress null
  run bash "$WAIT" "$SHA" --from ci-running; [ "$status" = 0 ] || fail "status $status"
  has "stage: ci-running (no change yet)"; has "next: bash scripts/ship/wait-for-next-stage.sh $SHA --from ci-running"
}
t_wait_link() {
  export VERCEL_TOKEN=test-token-123
  echo '{"link":{"type":"github","org":"derek-hobden","repo":"paper-golf","productionBranch":"main"}}' >"$FAKE_VERCEL_PROJECT"
  run bash "$WAIT" --link; has "vercel link: derek-hobden/paper-golf production-branch=main"
  logged "/v9/projects/prj_2wXuwwaoThxXs8GAfBfcreeFeWO0?teamId=team_NOIeemLqazmSprS9Y1tgjYx1"
}
t_wait_link_unlinked() { export VERCEL_TOKEN=t; run bash "$WAIT" --link; has "vercel link: none"; }
t_wait_link_no_token() { run bash "$WAIT" --link; [ "$status" = 0 ] || fail "status $status"; has "vercel link unknown"; }
t_wait_read_only() {
  export VERCEL_TOKEN=test-token-123
  ci completed '"success"'; deploy null READY "$SHA"
  run bash "$WAIT" "$SHA"; run bash "$WAIT" --link
  # Only GETs: no gh api method/field flags, no curl -X/-d, no other gh verbs.
  if grep -E -- ' (-X|--method|-f|-F|--field|--raw-field|-d|--data)( |$)' "$FAKE_LOG"; then fail "a non-GET call"; fi
  if grep -E '^gh ' "$FAKE_LOG" | grep -vE '^gh api '; then fail "a gh call other than api"; fi
}

# --- mirror-to-github.sh -------------------------------------------------------

# Bare repo (main, a bot/* branch, tag v1, no origin), its clone, and one job
# worktree under a fake jobs dir.
fixture() {
  local seed="$T/seed"
  real_git init -q -b main "$seed"
  real_git -C "$seed" -c user.name=t -c user.email=t@t commit -q --allow-empty -m one
  real_git -C "$seed" tag v1
  real_git -C "$seed" branch bot/job-x
  real_git init -q --bare -b main "$T/bare.git"
  real_git -C "$seed" push -q "$T/bare.git" main bot/job-x v1
  real_git clone -q "$T/bare.git" "$T/clone"
  mkdir -p "$T/jobs/job1"
  real_git -C "$T/clone" worktree add -q -b bot/job1 "$T/jobs/job1/worktree"
  echo 999999 >"$T/jobs/job1/claude.pid"
  echo '[]' >"$T/gitleaks.json"
  export PG_BARE="$T/bare.git" PG_CLONE="$T/clone" PG_JOBS_DIR="$T/jobs"
  MAIN_SHA="$(real_git -C "$T/bare.git" rev-parse main)"
}
remote() { real_git -C "$1" remote get-url "$2" 2>/dev/null || echo '<none>'; }

t_mirror_dry_run() {
  fixture
  run bash "$MIRROR" --report "$T/gitleaks.json"
  [ "$status" = 0 ] || fail "status $status"
  has "(DRY RUN)"; has "clean (0 findings)"; has "missing"
  has "would run: gh repo create derek-hobden/paper-golf --private"
  has "would run: git -C $T/bare.git push https://github.com/derek-hobden/paper-golf.git refs/heads/main:refs/heads/main refs/tags/*:refs/tags/*"
  has "main $MAIN_SHA"; has "tags: 1 (v1)"; has "one GitHub Actions CI run"
  has "before: origin=<none>"; has "before: origin=$T/bare.git"
  has "after:  origin=https://github.com/derek-hobden/paper-golf.git, local-bare=$T/bare.git"
  has "gh repo view derek-hobden/paper-golf --json visibility"; has "ls-remote origin main"
  has "wait-for-next-stage.sh --link"; has "npm run test:ship"
  has "nothing changed"
  [ "$(remote "$T/clone" origin)" = "$T/bare.git" ] || fail "clone origin changed"
  [ "$(remote "$T/bare.git" origin)" = '<none>' ] || fail "bare origin changed"
  not_logged "gh repo create"; not_logged " push "; not_logged "remote set-url"
}
t_mirror_needs_report() { fixture; run bash "$MIRROR"; [ "$status" = 1 ] || fail "status $status"; has "--report <gitleaks.json> is required"; }
t_mirror_report_missing() { fixture; run bash "$MIRROR" --report "$T/nope.json"; [ "$status" = 1 ] || fail "status $status"; has "not found"; }
t_mirror_report_findings() {
  fixture; echo '[{"RuleID":"generic-api-key","Secret":"REDACTED"}]' >"$T/gitleaks.json"
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes; [ "$status" = 1 ] || fail "status $status"
  has "1 finding(s); refusing"; not_logged "gh repo create"; not_logged " push "
}
t_mirror_report_not_array() {
  fixture; echo 'oops' >"$T/gitleaks.json"
  run bash "$MIRROR" --report "$T/gitleaks.json"; [ "$status" = 1 ] || fail "status $status"; has "not a JSON array"
}
t_mirror_gh_unauthenticated() {
  fixture; export FAKE_GH_AUTH=fail
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes; [ "$status" = 1 ] || fail "status $status"; has "not authenticated"
}
t_mirror_refuses_public_repo() {
  fixture; export FAKE_GH_VIS=PUBLIC
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes; [ "$status" = 1 ] || fail "status $status"
  has "is PUBLIC, not PRIVATE"; not_logged " push "
}
t_mirror_refuses_live_job() {
  fixture; echo $$ >"$T/jobs/job1/claude.pid"
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes; [ "$status" = 1 ] || fail "status $status"
  has "paper-golf jobs are live: job1"; has "--force-live-jobs"
  not_logged "gh repo create"; [ "$(remote "$T/clone" origin)" = "$T/bare.git" ] || fail "clone origin changed"
}
t_mirror_force_live_jobs() {
  fixture; echo $$ >"$T/jobs/job1/claude.pid"
  run bash "$MIRROR" --report "$T/gitleaks.json" --force-live-jobs; [ "$status" = 0 ] || fail "status $status"
  has "live: job1 (continuing: --force-live-jobs)"
}
t_mirror_yes() {
  fixture
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes
  [ "$status" = 0 ] || fail "status $status"
  has "(ACT)"
  logged "gh repo create derek-hobden/paper-golf --private"
  logged "git -C $T/bare.git push https://github.com/derek-hobden/paper-golf.git refs/heads/main:refs/heads/main refs/tags/*:refs/tags/*"
  not_logged "--force"; not_logged "--mirror"; not_logged "--delete"; not_logged "bot/job-x"; not_logged "commit"
  [ "$(remote "$T/clone" origin)" = https://github.com/derek-hobden/paper-golf.git ] || fail "clone origin"
  [ "$(remote "$T/clone" local-bare)" = "$T/bare.git" ] || fail "clone local-bare"
  [ "$(remote "$T/bare.git" origin)" = https://github.com/derek-hobden/paper-golf.git ] || fail "bare origin"
  [ "$(remote "$T/jobs/job1/worktree" origin)" = https://github.com/derek-hobden/paper-golf.git ] || fail "worktree shares origin"
  [ "$(real_git -C "$T/bare.git" rev-parse main)" = "$MAIN_SHA" ] || fail "main moved"
  logged "git -C $T/clone fetch origin"
}
t_mirror_yes_ssh_existing_private() {
  fixture; export FAKE_GH_PROTOCOL=ssh FAKE_GH_VIS=PRIVATE
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes; [ "$status" = 0 ] || fail "status $status"
  has "exists, PRIVATE"; not_logged "gh repo create"
  [ "$(remote "$T/clone" origin)" = git@github.com:derek-hobden/paper-golf.git ] || fail "clone origin"
}
t_mirror_yes_twice() {
  fixture
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes
  export FAKE_GH_VIS=PRIVATE
  run bash "$MIRROR" --report "$T/gitleaks.json" --yes; [ "$status" = 0 ] || fail "status $status"
  has "already done"
  [ "$(remote "$T/clone" local-bare)" = "$T/bare.git" ] || fail "local-bare lost"
}

t_shellcheck() {
  if ! command -v shellcheck >/dev/null 2>&1; then
    echo "skip: shellcheck not installed"
    return 0
  fi
  run shellcheck -x -P "$dir/../.." "$dir"/*.sh "$dir"/test-fakes/*
  [ "$status" = 0 ] || fail "shellcheck"
}

cases="$(declare -F | sed -n 's/^declare -f t_//p')"
case "${1:-}" in
  --list) printf '%s\n' "$cases"; exit 0 ;;
  '') ;;
  *)
    printf '%s\n' "$cases" | grep -qx -- "$1" || { echo "no such case: $1" >&2; exit 2; }
    setup
    "t_$1"
    echo "ok $1"
    exit 0 ;;
esac
failed=0
n=0
for c in $cases; do
  n=$((n + 1))
  # Each case in its own process, so set -e and the env stay per case.
  if res="$(bash "$0" "$c" 2>&1)"; then
    echo "ok $c"
  else
    echo "not ok $c"
    printf '%s\n' "$res" | sed 's/^/  /'
    failed=$((failed + 1))
  fi
done
echo "$((n - failed))/$n passed"
[ "$failed" = 0 ]

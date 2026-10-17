#!/usr/bin/env bash
# Tests for scripts/ship/wait-for-next-stage.sh, push-to-main.sh, check.sh and
# the ci.yml guards, with fake gh / curl / npm / actionlint and a git wrapper on
# PATH (scripts/ship/test-fakes) and temp fixture repos. No network, no real
# remote, nothing outside the temp dir changes.
#
#   bash scripts/ship/test-ship.sh            # all cases (npm run test:ship)
#   bash scripts/ship/test-ship.sh <case>     # one case (tests/ship.test.ts)
#   bash scripts/ship/test-ship.sh --list     # case names
set -euo pipefail
# Nothing here reads input; an inherited open stdin (vitest, background shells)
# can make wrapped tools wait on it.
exec </dev/null
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$dir/../.." && pwd)"
WAIT="$dir/wait-for-next-stage.sh"
PUSH="$dir/push-to-main.sh"
CHECK="$dir/check.sh"
CI_YML="$ROOT/.github/workflows/ci.yml"
ORIG_PATH="$PATH"
# Fixture setup and assertions use git without the fakes (not logged, real push).
real_git() { PATH="$ORIG_PATH" git "$@"; }
TMP_ROOT="$ROOT/node_modules/.cache/pg-ship-test"
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
  unset VERCEL_TOKEN FAKE_GH_AUTH FAKE_GH_VIS FAKE_GH_PROTOCOL FAKE_CURL_FAIL FAKE_NPM_FAIL FAKE_NPM_FAIL_FROM
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

# --- push-to-main.sh -------------------------------------------------------------

# gcommit <repo> <file> <content>: one commit, fixed identity.
gcommit() {
  echo "$3" >"$1/$2"
  real_git -C "$1" add "$2"
  real_git -C "$1" -c user.name=t -c user.email=t@t commit -q -m "$3"
}
# A plain checkout ($W, no job folder) whose origin is a local bare repo
# ($ORIGIN_DIR, not GitHub); $T/seed stands in for other jobs pushing to main.
# HEAD_SHA is one commit on a bot branch on top of origin/main. A logging git
# wrapper (real git, real local pushes) goes first on PATH, then the fake npm.
push_fixture() {
  ORIGIN_DIR="$T/origin.git" SEED="$T/seed" W="$T/checkout"
  real_git init -q --bare -b main "$ORIGIN_DIR"
  real_git init -q -b main "$SEED"
  gcommit "$SEED" base.txt base
  real_git -C "$SEED" push -q "$ORIGIN_DIR" main
  real_git clone -q "$ORIGIN_DIR" "$W"
  real_git -C "$W" checkout -q -b bot/x
  gcommit "$W" change.txt job-change
  HEAD_SHA="$(real_git -C "$W" rev-parse HEAD)"
  # The merge commit push-to-main.sh makes needs an identity.
  export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
  log_git
}
# Every git call is logged, then runs for real. While $FAKE_STATE/race holds a
# count above 0, each push first lets $SEED push one more commit to main (main
# moves under the push, so it is rejected).
log_git() {
  export ORIGIN_DIR SEED REAL_GIT_PATH="$ORIG_PATH"
  mkdir -p "$T/bin"
  cat >"$T/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "git $*" >>"$FAKE_LOG"
export PATH="$REAL_GIT_PATH"
for a; do
  [ "$a" = push ] || continue
  n="$(cat "$FAKE_STATE/race" 2>/dev/null || echo 0)"
  if [ "$n" -gt 0 ]; then
    echo $((n - 1)) >"$FAKE_STATE/race"
    echo "race $n" >"$SEED/race-$n.txt"
    git -C "$SEED" add "race-$n.txt"
    git -C "$SEED" -c user.name=t -c user.email=t@t commit -q -m "race $n"
    git -C "$SEED" push -q "$ORIGIN_DIR" main
  fi
  break
done
exec git "$@"
EOF
  chmod +x "$T/bin/git"
  export PATH="$T/bin:$PATH"
}
# origin's main moves on by one commit (another job's push).
origin_moves() {
  gcommit "$SEED" "${1:-other.txt}" "${2:-other}"
  real_git -C "$SEED" push -q "$ORIGIN_DIR" main
}
origin_main() { real_git -C "$ORIGIN_DIR" rev-parse -q --verify refs/heads/main || true; }
# The refs origin holds (not the symbolic HEAD a bare repo also lists).
remote_refs() { real_git ls-remote --refs "$ORIGIN_DIR"; }
push() {
  status=0
  out="$(cd "$W" && bash "$PUSH" "$@" 2>&1)" || status=$?
}
ok() { [ "$status" = 0 ] || fail "status $status (want 0)"; }
# No push, no force, no tags, nothing but HEAD:refs/heads/main.
safe_pushes() {
  not_logged "--force"; not_logged "--mirror"; not_logged "--delete"; not_logged "--tags"; not_logged "refs/tags"
  not_logged " rebase"; not_logged "+refs"
  if grep ' push ' "$FAKE_LOG" | grep -vE ' push origin [0-9a-f]{40}:refs/heads/main$'; then fail "an unexpected push"; fi
}
stopped() {
  [ "$status" = 1 ] || fail "status $status (want 1)"
  has "$1"; not_logged " push "
}
checks_run() { [ "$(grep -cxF 'npm run check' "$FAKE_LOG")" = "$1" ] || fail "want npm run check $1 time(s)"; }
smokes_run() { [ "$(grep -cxF 'npm run smoke' "$FAKE_LOG")" = "$1" ] || fail "want npm run smoke $1 time(s)"; }

t_push_help() {
  run bash "$PUSH" --help; ok; has "--dry-run"; has "git merge --no-edit origin/main"; hasnt "approval"
}
t_push_any_origin() {
  push_fixture
  push; ok
  has "→ origin: $ORIGIN_DIR"; has "Pushed ${HEAD_SHA:0:12} to main"
  [ "$(origin_main)" = "$HEAD_SHA" ] || fail "origin main is not HEAD"
  logged "git -c push.followTags=false push origin $HEAD_SHA:refs/heads/main"
  checks_run 1; smokes_run 1; safe_pushes
}
t_push_from_subdirectory_without_job_folder() {
  push_fixture; mkdir -p "$W/sub"
  status=0; out="$(cd "$W/sub" && bash "$PUSH" 2>&1)" || status=$?
  ok; [ "$(origin_main)" = "$HEAD_SHA" ] || fail "not pushed"; hasnt "job folder"
}
t_push_dry_run_does_not_push() {
  push_fixture; local before; before="$(origin_main)"
  push --dry-run; ok
  has "Dry run: would run git push origin $HEAD_SHA:refs/heads/main"
  logged "git fetch --no-tags origin main"; checks_run 1; not_logged " push "
  [ "$(origin_main)" = "$before" ] || fail "origin changed"
}
t_push_merges_when_main_moved() {
  push_fixture; origin_moves; local moved; moved="$(origin_main)"
  push; ok
  has "1 commit(s) this branch lacks: merging"
  local head; head="$(real_git -C "$W" rev-parse HEAD)"
  [ "$(origin_main)" = "$head" ] || fail "origin main is not the merged HEAD"
  [ "$(real_git -C "$W" rev-parse HEAD^1)" = "$HEAD_SHA" ] || fail "first parent is not the job commit"
  [ "$(real_git -C "$W" rev-parse HEAD^2)" = "$moved" ] || fail "second parent is not origin/main"
  logged "git merge --no-edit origin/main"; checks_run 2; smokes_run 2; safe_pushes
}
t_push_refuses_uncommitted_tracked_changes() {
  push_fixture; echo x >"$W/change.txt"
  push; stopped "uncommitted changes to tracked files"; not_logged "npm run"; not_logged "git fetch"
}
t_push_untracked_files_are_fine() {
  push_fixture; echo x >"$W/scratch.txt"
  push; ok; [ "$(origin_main)" = "$HEAD_SHA" ] || fail "not pushed"
}
t_push_stops_on_failing_check() {
  push_fixture; export FAKE_NPM_FAIL=check; local before; before="$(origin_main)"
  push; stopped "npm run check failed on ${HEAD_SHA:0:12}"; not_logged "git fetch"; not_logged "npm run smoke"
  [ "$(origin_main)" = "$before" ] || fail "origin changed"
}
t_push_stops_on_failing_check_after_merge() {
  push_fixture; origin_moves; export FAKE_NPM_FAIL=check FAKE_NPM_FAIL_FROM=2; local before; before="$(origin_main)"
  push; stopped "npm run check failed"; logged "git merge --no-edit origin/main"; checks_run 2
  [ "$(origin_main)" = "$before" ] || fail "origin changed"
}
# The merge breakages of parallel jobs were e2e-only (audit #5): smoke runs
# again after merging origin/main, on the caller's SMOKE_PORT, and a red smoke
# stops the push. Smoke also runs before the fetch, so a rerun after a red
# smoke (the merge commit stays on the branch) still smokes the merge.
t_push_merge_runs_smoke() {
  push_fixture; origin_moves; export SMOKE_PORT=4999 FAKE_NPM_FAIL=smoke FAKE_NPM_FAIL_FROM=2
  local before; before="$(origin_main)"
  push; stopped "npm run smoke failed"; checks_run 2; smokes_run 2; logged "env SMOKE_PORT=4999"
  local merge_line smoke_line
  merge_line="$(grep -nF 'git merge --no-edit origin/main' "$FAKE_LOG" | cut -d: -f1)"
  smoke_line="$(grep -nxF 'npm run smoke' "$FAKE_LOG" | tail -1 | cut -d: -f1)"
  if [ -z "$merge_line" ] || [ "${smoke_line:-0}" -le "$merge_line" ]; then fail "smoke did not run after the merge"; fi
  [ "$(origin_main)" = "$before" ] || fail "origin changed"
  export FAKE_NPM_FAIL_FROM=3
  push; stopped "npm run smoke failed"; smokes_run 3
  [ "$(origin_main)" = "$before" ] || fail "origin changed on the rerun"
}
t_push_stops_on_merge_conflict() {
  push_fixture; origin_moves change.txt conflicting-change; local before; before="$(origin_main)"
  push; stopped "merge conflict with origin/main (merge aborted, nothing pushed)"; checks_run 1
  [ "$(origin_main)" = "$before" ] || fail "origin changed"
  [ "$(real_git -C "$W" rev-parse HEAD)" = "$HEAD_SHA" ] || fail "HEAD changed"
  [ -z "$(real_git -C "$W" status --porcelain)" ] || fail "checkout left mid-merge"
}
t_push_first_push_to_empty_origin() {
  push_fixture
  real_git init -q --bare -b main "$T/empty.git"
  real_git -C "$W" remote remove origin
  real_git -C "$W" remote add origin "$T/empty.git"
  ORIGIN_DIR="$T/empty.git"
  [ -z "$(remote_refs)" ] || fail "origin not empty before"
  push; ok
  has "origin has no main: first push of main"; has "Pushed ${HEAD_SHA:0:12} to main"
  not_logged "git fetch"; safe_pushes
  out="$(remote_refs)"
  [ "$out" = "$HEAD_SHA	refs/heads/main" ] || fail "origin should hold only refs/heads/main = $HEAD_SHA"
}
t_push_only_main_never_force_or_tags() {
  push_fixture; real_git -C "$W" tag v1; origin_moves
  push; ok; safe_pushes
  [ "$(grep -c ' push ' "$FAKE_LOG")" = 1 ] || fail "expected exactly one push"
  out="$(remote_refs)"; hasnt "refs/tags"; hasnt "bot/x"
}
t_push_retries_when_main_moves_during_push() {
  push_fixture; echo 1 >"$FAKE_STATE/race"
  push; ok
  has "push rejected: main probably moved"; has "try 2 of 3"
  [ "$(grep -c ' push origin ' "$FAKE_LOG")" = 2 ] || fail "expected two pushes"
  local head; head="$(real_git -C "$W" rev-parse HEAD)"
  [ "$(origin_main)" = "$head" ] || fail "origin main is not the merged HEAD"
  real_git -C "$W" merge-base --is-ancestor "$HEAD_SHA" "$head" || fail "job commit lost"
  checks_run 2; smokes_run 2; safe_pushes
}
t_push_gives_up_after_three_rejections() {
  push_fixture; echo 5 >"$FAKE_STATE/race"
  push; [ "$status" = 1 ] || fail "status $status"
  has "the push was rejected 3 times"
  [ "$(grep -c ' push origin ' "$FAKE_LOG")" = 3 ] || fail "expected three pushes"
  real_git -C "$ORIGIN_DIR" merge-base --is-ancestor "$HEAD_SHA" main && fail "job commit reached main"
  safe_pushes
}
t_push_nothing_to_push() {
  push_fixture; real_git -C "$W" checkout -q main
  push; ok; has "nothing to push"; not_logged " push "
}

# --- check.sh -------------------------------------------------------------------

check_fixture() {
  real_git init -q -b main "$T/repo"
  gcommit "$T/repo" a.txt a
}
t_check_runs_every_check() {
  check_fixture
  run bash -c "cd '$T/repo' && bash '$CHECK'"; [ "$status" = 0 ] || fail "status $status"
  logged "npm run check"; logged "npm run smoke"; logged "actionlint"; has "Checks passed on"
}
t_check_smoke_fails() {
  check_fixture; export FAKE_NPM_FAIL=smoke
  run bash -c "cd '$T/repo' && bash '$CHECK'"; [ "$status" = 1 ] || fail "status $status"
  has "checks failed"; hasnt "Checks passed"; not_logged "actionlint"
}
t_check_dirty_refused() {
  check_fixture; echo b >"$T/repo/b.txt"
  run bash -c "cd '$T/repo' && bash '$CHECK'"; [ "$status" = 1 ] || fail "status $status"
  has "uncommitted changes"; not_logged "npm run"
}

# --- ci.yml and the no-tags rule -------------------------------------------------

# The lines of one job (from "  <name>:" to the next job) in ci.yml.
job_block() { awk -v j="  $1:" '$0 == j {p = 1; next} p && /^  [a-z-]+:$/ {p = 0} p' "$CI_YML"; }
t_ci_triggers_main_and_dispatch_only() {
  out="$(sed -n '/^on:/,/^concurrency:/p' "$CI_YML")"
  has "  push:"; has "branches: [main]"; has "workflow_dispatch:"; has "confirm:"; has "sha:"
  hasnt "bot/"; hasnt "tags"; hasnt "pull_request"; hasnt "schedule"
}
t_ci_production_only_by_confirmed_dispatch() {
  out="$(job_block deploy-production)"
  has "needs: [resolve, check, smoke]"
  has "github.event_name == 'workflow_dispatch'"; has "inputs.confirm == 'deploy-production'"; has "--prod"
  [ "$(job_block deploy-production | grep -c -- '--prod')" = "$(grep -c -- '--prod' "$CI_YML")" ] ||
    fail "--prod outside the deploy-production job"
  out="$(job_block resolve)"; has 'CONFIRM" = deploy-production'; has "merge-base --is-ancestor"
}
t_ci_preview_after_ci_on_push() {
  out="$(job_block deploy-preview)"
  has "needs: [resolve, check, smoke]"; has "if: github.event_name == 'push'"
  has "vercel deploy --prebuilt --scope"; hasnt "--prod"
}
t_ci_vercel_token_from_secret_env_only() {
  out="$(cat "$CI_YML")"
  hasnt "--token"; has "VERCEL_ORG_ID: team_NOIeemLqazmSprS9Y1tgjYx1"
  has "VERCEL_PROJECT_ID: prj_2wXuwwaoThxXs8GAfBfcreeFeWO0"; has "VERCEL_SCOPE: derek-hobden"
  grep -qE '^  VERCEL_CLI: vercel@[0-9]+\.[0-9]+\.[0-9]+$' "$CI_YML" || fail "VERCEL_CLI is not an exact version"
  local want="VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}"
  out="$(grep -n 'VERCEL_TOKEN:' "$CI_YML")"
  if grep 'VERCEL_TOKEN:' "$CI_YML" | grep -vqF "$want"; then
    fail "VERCEL_TOKEN set from something other than the repo secret"
  fi
  # Vercel commands run only in the two deploy jobs.
  local j
  for j in resolve check smoke; do
    out="$(job_block "$j")"; hasnt "vercel "; hasnt "VERCEL_TOKEN"
  done
}
t_actionlint() {
  if ! PATH="$ORIG_PATH" command -v actionlint >/dev/null 2>&1; then
    echo "skip: actionlint not installed"
    return 0
  fi
  out="$(cd "$ROOT" && PATH="$ORIG_PATH" actionlint 2>&1)" || fail "actionlint"
}
# Paper Golf uses no tags (bfbfb25's mirror pushed refs/tags/*, which the gate
# read as a production tag push): no ship script or workflow names one.
t_no_tags_in_ship_scripts_or_workflows() {
  local f
  for f in "$dir"/*.sh "$ROOT"/.github/workflows/*.yml; do
    [ "$f" = "$dir/test-ship.sh" ] && continue
    out="$(grep -nE -- 'refs/tags|--tags|--follow-tags|--mirror|git tag|^[[:space:]]+tags:' "$f" || true)"
    [ -z "$out" ] || fail "$f names a tag push"
  done
  [ ! -e "$dir/mirror-to-github.sh" ] || fail "mirror-to-github.sh is retired"
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
    # A here-string, not printf | grep -q: under pipefail an early grep exit
    # can SIGPIPE printf and report a real case as missing.
    grep -qx -- "$1" <<<"$cases" || { echo "no such case: $1" >&2; exit 2; }
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

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
GH_URL=https://github.com/derek-hobden/paper-golf.git

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
  unset VERCEL_TOKEN FAKE_GH_AUTH FAKE_GH_VIS FAKE_GH_PROTOCOL FAKE_CURL_FAIL FAKE_NPM_FAIL
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

OLD_DATE=2020-01-01T10:00:00+00:00
now_iso() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
# gcommit <repo> <file> <content> [date]: one commit, fixed identity.
gcommit() {
  echo "$3" >"$1/$2"
  real_git -C "$1" add "$2"
  GIT_AUTHOR_DATE="${4:-$OLD_DATE}" GIT_COMMITTER_DATE="${4:-$OLD_DATE}" \
    real_git -C "$1" -c user.name=t -c user.email=t@t commit -q -m "$3"
}
# A job folder ($J) whose worktree is a clone of a stand-in for GitHub ($T/gh.git)
# with origin then pointed at the GitHub URL; fetch and push are faked, so
# nothing leaves $T. HEAD_SHA is one job commit on top of origin/main.
push_fixture() {
  J="$T/jobs/20261014-000000-pg-x"
  real_git init -q -b main "$T/seed"
  gcommit "$T/seed" base.txt base
  real_git init -q --bare -b main "$T/gh.git"
  real_git -C "$T/seed" push -q "$T/gh.git" main
  mkdir -p "$J/approvals"
  echo '{"repo":"paper-golf"}' >"$J/meta.json"
  real_git clone -q "$T/gh.git" "$J/worktree"
  real_git -C "$J/worktree" remote set-url origin "$GH_URL"
  gcommit "$J/worktree" change.txt job-change
  HEAD_SHA="$(real_git -C "$J/worktree" rev-parse HEAD)"
  export SHIP_APPROVAL_LIB="$dir/test-fixtures/approval-lib.sh"
  origin_git "$T/gh.git"
}
# A git wrapper ahead of test-fakes on PATH for the push cases: every call is
# logged; ls-remote and push to "origin" (the GitHub URL) really go to the
# local bare repo $1 instead, fetch stays a no-op (origin/main is set by the
# fixtures). No network.
origin_git() {
  export ORIGIN_DIR="$1" REAL_GIT_PATH="$ORIG_PATH"
  mkdir -p "$T/bin"
  cat >"$T/bin/git" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "git $*" >>"$FAKE_LOG"
sub=''
for a; do
  case "$a" in push | fetch | ls-remote) [ -n "$sub" ] || sub="$a" ;; esac
done
[ "$sub" != fetch ] || exit 0
args=()
for a; do
  if [ -n "$sub" ] && [ "$a" = origin ]; then a="$ORIGIN_DIR"; fi
  args+=("$a")
done
PATH="$REAL_GIT_PATH" exec git "${args[@]}"
EOF
  chmod +x "$T/bin/git"
  export PATH="$T/bin:$PATH"
}
# origin (GitHub) is a brand-new repo with no refs at all, and the worktree has
# no origin/main either (as right after switching origin to it).
empty_origin() {
  real_git init -q --bare -b main "$T/empty.git"
  real_git -C "$J/worktree" update-ref -d refs/remotes/origin/main
  origin_git "$T/empty.git"
}
# The refs origin holds (not the symbolic HEAD a bare repo also lists).
remote_refs() { real_git ls-remote --refs "$ORIGIN_DIR"; }
# approve <commit> [time]: Derek's yes as bots-work lib/record-approval.sh writes it.
approve() {
  jq -n --arg commit "$1" --arg time "${2:-$(now_iso)}" --arg job "$(basename "$J")" \
    '{approved_by: "Derek", step: "main", job: $job, bot: "Golf Gary", quote: "yes ship it", time: $time, commit: $commit}' \
    >"$J/approvals/main.json"
}
# checks <commit> [result]: a record as bots-work lib/record-checks.sh writes it.
checks() {
  jq -n --arg commit "$1" --arg result "${2:-pass}" --arg at "$(now_iso)" \
    '{commit: $commit, result: $result, cmd: "bash scripts/ship/check.sh", at: $at}' >"$J/approvals/checks.json"
}
# origin/main moves on by one unrelated commit (as after someone else's push).
origin_moves() {
  gcommit "$T/seed" other.txt other
  real_git -C "$T/seed" push -q "$T/gh.git" main
  real_git -C "$J/worktree" fetch -q "$T/gh.git" main:refs/remotes/origin/main
}
rebase_job() { real_git -C "$J/worktree" -c user.name=t -c user.email=t@t rebase -q origin/main; }
push() {
  status=0
  out="$(cd "$J/worktree" && bash "$PUSH" "$@" 2>&1)" || status=$?
}
refused() {
  [ "$status" = 1 ] || fail "status $status (want 1)"
  has "$1"
  not_logged " push "
}

t_push_help() { run bash "$PUSH" --help; [ "$status" = 0 ] || fail "status $status"; has "--dry-run"; has "approval_for_sha"; }
t_push_no_approval() { push_fixture; checks "$HEAD_SHA"; push; refused "refused: no approvals/main.json"; }
t_push_stale_approval() {
  push_fixture; approve "$HEAD_SHA" 2020-01-01T09:00:00Z; checks "$HEAD_SHA"
  push; refused "is not newer than the job's last commit"
}
t_push_approval_not_derek() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"
  jq '.approved_by = "Hal"' "$J/approvals/main.json" >"$T/m.json" && mv "$T/m.json" "$J/approvals/main.json"
  push; refused "must be Derek"
}
t_push_approval_other_commit() {
  push_fixture; approve "$(real_git -C "$J/worktree" rev-parse origin/main)"; checks "$HEAD_SHA"
  push; refused "needs a fresh yes"
}
t_push_no_checks_record() { push_fixture; approve "$HEAD_SHA"; push; refused "no approvals/checks.json"; }
t_push_checks_other_commit() {
  push_fixture; approve "$HEAD_SHA"; checks "$(real_git -C "$J/worktree" rev-parse origin/main)"
  push; refused "needs fresh checks"
}
t_push_checks_failed() { push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA" fail; push; refused "result is 'fail'"; }
t_push_valid_dry_run() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"
  push --dry-run; [ "$status" = 0 ] || fail "status $status"
  has "approved and checked: ${HEAD_SHA:0:12} by Derek (Golf Gary)"
  has "Dry run: would run git push origin $HEAD_SHA:refs/heads/main"
  logged "git fetch --no-tags origin main"; not_logged " push "
}
t_push_valid() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"
  push; [ "$status" = 0 ] || fail "status $status"
  has "Pushed ${HEAD_SHA:0:12} to main"; has "next:   bash scripts/ship/wait-for-next-stage.sh ${HEAD_SHA:0:12} --from pushed"
  logged "git -c push.followTags=false push origin $HEAD_SHA:refs/heads/main"
  [ "$(grep -c ' push ' "$FAKE_LOG")" = 1 ] || fail "expected exactly one push"
  not_logged "--force"; not_logged "--tags"; not_logged "--mirror"; not_logged "--delete"; not_logged "refs/tags"
}
t_push_rebased_same_patch() {
  push_fixture; approve "$HEAD_SHA"; origin_moves; rebase_job
  local rebased; rebased="$(real_git -C "$J/worktree" rev-parse HEAD)"
  [ "$rebased" != "$HEAD_SHA" ] || fail "rebase did not change the sha"
  checks "$rebased"
  push; [ "$status" = 0 ] || fail "status $status"
  logged "push origin $rebased:refs/heads/main"
}
t_push_rebased_needs_fresh_checks() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"; origin_moves; rebase_job
  push; refused "needs fresh checks"
}
t_push_rebased_changed_patch() {
  push_fixture; approve "$HEAD_SHA"; origin_moves; rebase_job
  gcommit "$J/worktree" change.txt changed-after-yes "$(now_iso)"
  checks "$(real_git -C "$J/worktree" rev-parse HEAD)"
  push; refused "patch changed since approval"
}
t_push_not_on_origin_main() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"; origin_moves
  push; refused "is not on top of origin/main"
}
t_push_origin_not_github() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"
  real_git -C "$J/worktree" remote set-url origin "$T/gh.git"
  push; refused "not GitHub derek-hobden/paper-golf"
}
t_push_dirty_worktree() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"; echo x >"$J/worktree/change.txt"
  push; refused "uncommitted changes"
}
t_push_no_approval_lib() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"; export SHIP_APPROVAL_LIB="$T/none.sh"
  push; refused "approval lib not found"
}
t_push_outside_job_worktree() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"
  push --job "$T"; refused "not a job folder"
}
t_push_first_push_empty_remote() {
  push_fixture; empty_origin; approve "$HEAD_SHA"; checks "$HEAD_SHA"
  [ -z "$(remote_refs)" ] || fail "origin not empty before"
  push; [ "$status" = 0 ] || fail "status $status"
  has "origin has no refs at all: first push of main"; has "Pushed ${HEAD_SHA:0:12} to main"
  logged "git ls-remote origin"; not_logged "git fetch"
  logged "git -c push.followTags=false push origin $HEAD_SHA:refs/heads/main"
  not_logged "--force"; not_logged "--tags"; not_logged "refs/tags"
  out="$(remote_refs)"
  [ "$out" = "$HEAD_SHA	refs/heads/main" ] || fail "origin should hold only refs/heads/main = $HEAD_SHA"
}
t_push_first_push_needs_approval() {
  push_fixture; empty_origin; checks "$HEAD_SHA"
  push; refused "refused: no approvals/main.json"
  has "first push of main"
  [ -z "$(remote_refs)" ] || fail "origin changed"
}
t_push_first_push_needs_checks_record() {
  push_fixture; empty_origin; approve "$HEAD_SHA"
  push; refused "no approvals/checks.json"
  [ -z "$(remote_refs)" ] || fail "origin changed"
}
t_push_first_push_dry_run() {
  push_fixture; empty_origin; approve "$HEAD_SHA"; checks "$HEAD_SHA"
  push --dry-run; [ "$status" = 0 ] || fail "status $status"
  has "first push of main"; has "Dry run: would run git push origin $HEAD_SHA:refs/heads/main"
  not_logged " push "; [ -z "$(remote_refs)" ] || fail "origin changed"
}
t_push_non_empty_remote_keeps_main_check() {
  push_fixture; approve "$HEAD_SHA"; checks "$HEAD_SHA"; origin_moves
  push; refused "is not on top of origin/main"; hasnt "first push"
}
t_push_nothing_to_push() {
  push_fixture; real_git -C "$J/worktree" update-ref refs/remotes/origin/main "$HEAD_SHA"
  push; [ "$status" = 0 ] || fail "status $status"; has "nothing to push"; not_logged " push "
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
  [ ! -e "$dir/mirror-to-github.sh" ] || fail "mirror-to-github.sh is retired: GitHub is origin"
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

#!/usr/bin/env bash
# Tests for scripts/ship/wait-for-next-stage.sh, pr-risk.sh, check.sh, the
# retired push-to-main.sh and the workflow guards (.github/workflows/ci.yml and
# claude-review.yml), with fake gh / curl / npm / actionlint and a git wrapper
# on PATH (scripts/ship/test-fakes) and temp fixture repos. No network, no real
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
RISK="$dir/pr-risk.sh"
CHECK="$dir/check.sh"
CI_YML="$ROOT/.github/workflows/ci.yml"
REVIEW_YML="$ROOT/.github/workflows/claude-review.yml"
WORKFLOWS="$ROOT/.github/workflows"
# The one staging host every staging deploy is aliased to (CLAUDE.md "Ship process").
STAGING_ALIAS=paper-golf-staging-derek-hobden.vercel.app
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

# --- push-to-main.sh (retired) --------------------------------------------------

# gcommit <repo> <file> <content>: one commit, fixed identity.
gcommit() {
  echo "$3" >"$1/$2"
  real_git -C "$1" add "$2"
  real_git -C "$1" -c user.name=t -c user.email=t@t commit -q -m "$3"
}

# Nothing pushes to main any more: every change is a PR and the merge pipeline
# deploys (CLAUDE.md "Ship process"). push-to-main.sh is kept only to refuse,
# so an old habit (or an agent working from a stale memory) cannot push.
t_push_to_main_retired() {
  local a
  for a in '' --dry-run --help; do
    run bash "$PUSH" $a
    [ "$status" = 1 ] || fail "status $status (want 1) for '$a'"
    has "retired"; has "pull request"
  done
  not_logged " push "; not_logged "npm run"; not_logged "git fetch"
  # It can push nothing: no push, no force, no refspec, no git at all.
  out="$(cat "$PUSH")"; hasnt "push origin"; hasnt "refs/heads/main"
}

# --- pr-risk.sh -----------------------------------------------------------------

# A repo whose main holds a small app and this repo's package.json, and a
# branch "pr" the cases commit onto.
risk_fixture() {
  R="$(mktemp -d "$T/risk.XXXXXX")"
  real_git init -q -b main "$R"
  mkdir -p "$R/src"
  printf 'const a = 1;\n' >"$R/src/app.ts"
  cp "$ROOT/package.json" "$R/package.json"
  real_git -C "$R" add -A
  real_git -C "$R" -c user.name=t -c user.email=t@t commit -q -m base
  real_git -C "$R" checkout -q -b pr
}
# rcommit <path> <content> ...: write the pairs and commit them on pr.
rcommit() {
  while [ $# -gt 0 ]; do
    mkdir -p "$(dirname "$R/$1")"
    printf '%s' "$2" >"$R/$1"
    shift 2
  done
  real_git -C "$R" add -A
  real_git -C "$R" -c user.name=t -c user.email=t@t commit -q -m change
}
# lines <n> <text>: n lines of text, for the diff-size rule.
lines() { local i=0 s=''; while [ "$i" -lt "$1" ]; do s="$s$2 $i"$'\n'; i=$((i + 1)); done; printf '%s' "$s"; }
risk() {
  status=0
  out="$(cd "$R" && bash "$RISK" main pr 2>&1)" || status=$?
}
low() { [ "$status" = 0 ] || fail "status $status"; has "risk=low"; hasnt "risk=high"; hasnt "reason="; }
high() { [ "$status" = 0 ] || fail "status $status"; has "risk=high"; hasnt "risk=low"; has "reason=$1"; }

t_risk_help_and_bad_args() {
  run bash "$RISK" --help; [ "$status" = 0 ] || fail "status $status"; has "risk=low|high"
  run bash "$RISK"; [ "$status" = 2 ] || fail "status $status"
  run bash "$RISK" main pr extra; [ "$status" = 2 ] || fail "status $status"
}
t_risk_low_small_source_change() {
  risk_fixture; rcommit src/app.ts "$(lines 20 'const x =')"
  risk; low; has "lines=21"
}
t_risk_high_on_ci_or_deploy_config() {
  risk_fixture; rcommit .github/workflows/ci.yml 'on: push'
  risk; high "touches CI or deploy config: .github/workflows/ci.yml"
  risk_fixture; rcommit vercel.json '{}'; risk; high "touches CI or deploy config: vercel.json"
  risk_fixture; rcommit scripts/ship/x.sh 'echo'; risk; high "touches CI or deploy config: scripts/ship/x.sh"
  risk_fixture; rcommit playwright.config.ts 'export default {};'
  risk; high "touches CI or deploy config: playwright.config.ts"
}
t_risk_high_on_secrets_or_env() {
  risk_fixture; rcommit .env.local 'A=1'
  risk; high "touches secrets or env vars: .env.local"
  risk_fixture; rcommit src/app.ts 'const k = process.env.API_KEY;'
  risk; high "adds a secret or env var read"
}
t_risk_high_on_auth_or_payment_code() {
  risk_fixture; rcommit src/auth/login.ts 'export const login = () => 1;'
  risk; high "touches auth or payment code: src/auth/login.ts"
  risk_fixture; rcommit src/payment.ts 'export const pay = () => 1;'
  risk; high "touches auth or payment code: src/payment.ts"
}
t_risk_dependency_bumps() {
  risk_fixture
  rcommit package.json "$(sed 's/"vite": "\^8\./"vite": "^9./' "$ROOT/package.json")"
  risk; high "dependency major bump: vite"
  risk_fixture
  rcommit package.json "$(sed 's/"vite": "\^8\.3\.4"/"vite": "^8.4.0"/' "$ROOT/package.json")"
  risk; low
}
t_risk_high_on_large_diff() {
  risk_fixture; rcommit src/app.ts "$(lines 500 'const x =')"
  risk; high "over about 400 changed lines outside tests and lockfiles: 501"; has "lines=501"
}
t_risk_low_when_only_tests_and_lockfiles_are_large() {
  risk_fixture
  rcommit tests/big.test.ts "$(lines 300 'it;')" e2e/big.spec.ts "$(lines 300 'it;')" \
    package-lock.json "$(lines 300 '"x":')" src/app.ts "$(lines 10 'const x =')"
  risk; low; has "lines=11"
}
t_risk_reads_only() {
  risk_fixture; rcommit src/app.ts 'const a = 2;'
  risk; low
  if grep -E '^git ' "$FAKE_LOG" | grep -vE '^git (diff|show|merge-base|rev-parse|-C)' ; then fail "a writing git call"; fi
  not_logged " push "; not_logged " commit "; not_logged " fetch "
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

# --- the workflow guards (ci.yml, claude-review.yml) ----------------------------

# The lines of one job (from "  <name>:" to the next job) in a workflow.
job_block() { awk -v j="  $1:" '$0 == j {p = 1; next} p && /^  [a-z_-]+:$/ {p = 0} p' "${2:-$CI_YML}"; }
# The `on:` block of a workflow (the lines after "on:", to the next top-level key).
on_block() { awk '/^on:/ {p = 1; next} p && /^[a-z]/ {p = 0} p' "$1"; }
# Every job id of a workflow (the 2-space keys with no value; `on:`'s triggers
# read the same way, which no case here minds).
job_ids() { grep -oE '^  [a-z_-]+:$' "$1" | tr -d ' :'; }

t_ci_triggers_pr_main_and_dispatch_only() {
  out="$(on_block "$CI_YML")"
  has "  pull_request:"; has "  push:"; has "branches: [main]"
  has "workflow_dispatch:"; has "confirm:"; has "sha:"
  hasnt "bot/"; hasnt "tags"; hasnt "schedule"
  # No workflow has a trigger but pull_request, push to main and workflow_dispatch.
  local f t
  for f in "$WORKFLOWS"/*.yml; do
    while read -r t; do
      [ -n "$t" ] || continue
      case "$t" in pull_request | push | workflow_dispatch) ;; *) fail "$f has the trigger $t" ;; esac
    done <<<"$(on_block "$f" | grep -oE '^  [a-z_]+:' | tr -d ' :')"
    out="$(on_block "$f")"
    case "$out" in *"  push:"*) has "branches: [main]" ;; esac
  done
}
# Change 1: every PR to main runs the same check and smoke jobs as main, under
# the same names (they are the required status checks), gated by no event.
t_ci_check_and_smoke_run_on_every_pr() {
  local j
  for j in check smoke; do
    out="$(job_block "$j")"
    [ -n "$out" ] || fail "no $j job"
    has "npm ci"
    if job_block "$j" | grep -q 'if: github.event_name'; then fail "the $j job is gated by the event"; fi
  done
  out="$(job_block check)"; has "npm run check"
  # The PR smoke job stays the full suite. `npm run smoke` is a substring of `npm run smoke:quick`.
  out="$(job_block smoke)"
  printf '%s\n' "$out" | grep -qx '      - run: npm run smoke' || fail "the smoke job must run the full npm run smoke"
  hasnt "smoke:quick"
  has "playwright install --with-deps webkit"
}
# Change 3: staging is every green push to main, preview target, on the one
# fixed staging host, smoked there. Previews as a product are gone.
t_ci_staging_after_ci_on_push() {
  out="$(job_block staging)"
  [ -n "$out" ] || fail "no staging job"
  has "needs: [resolve, check, smoke]"; has "if: github.event_name == 'push'"
  has "vercel deploy --prebuilt --scope"; hasnt "--prod"
  has "vercel alias set"; has "$STAGING_ALIAS"
  has "SMOKE_BASE_URL"
  # Staging stays the full suite. `npm run smoke` is a substring of `npm run smoke:quick`.
  printf '%s\n' "$out" | grep -qx '        run: npm run smoke' || fail "staging must run the full npm run smoke"
  hasnt "smoke:quick"
}
# Change 5: production is the same sha, only after the staging smoke (or the
# emergency dispatch), smoked again, and rolled back to the last good deploy
# when that smoke fails.
t_ci_production_needs_staging_smoke() {
  out="$(job_block production)"
  [ -n "$out" ] || fail "no production job"
  has "needs: [resolve, check, smoke, staging]"
  has "needs.staging.result == 'success'"
  has "github.event_name == 'push'"
  has "github.event_name == 'workflow_dispatch'"; has "inputs.confirm == 'deploy-production'"
  has "vercel deploy --prebuilt --prod"; has "vercel rollback"
  has "SMOKE_BASE_URL"; has "GITHUB_STEP_SUMMARY"
  # Post-deploy production smoke is the fast @quick Chrome run. The rollback step still re-runs the full suite.
  local step
  step="$(printf '%s\n' "$out" | awk '
    /- name: smoke production$/ {p = 1}
    p && /^      - / && !/name: smoke production$/ {exit}
    p {print}
  ')"
  [ -n "$step" ] || fail "no smoke production step"
  printf '%s\n' "$step" | grep -qx '        run: npm run smoke:quick' || fail "production smoke must run npm run smoke:quick"
  printf '%s\n' "$out" | grep -qxF '            if [ -n "$LAST_GOOD_URL" ] && SMOKE_BASE_URL="$LAST_GOOD_URL" npm run smoke; then' ||
    fail "rollback must keep the full npm run smoke"
  # --prod lives in this job alone, in every workflow.
  [ "$(job_block production | grep -c -- '--prod')" = "$(cat "$WORKFLOWS"/*.yml | grep -c -- '--prod')" ] ||
    fail "--prod outside the production job"
  out="$(job_block resolve)"; has 'CONFIRM" = deploy-production'; has "merge-base --is-ancestor"
  # A production run is never cancelled by concurrency; a PR run is.
  out="$(sed -n '/^concurrency:/,/^permissions:/p' "$CI_YML")"
  has "cancel-in-progress: \${{ github.event_name == 'pull_request' }}"
}
t_ci_vercel_token_from_secret_env_only() {
  out="$(cat "$CI_YML")"
  hasnt "--token"; has "VERCEL_ORG_ID: team_NOIeemLqazmSprS9Y1tgjYx1"
  has "VERCEL_PROJECT_ID: prj_2wXuwwaoThxXs8GAfBfcreeFeWO0"; has "VERCEL_SCOPE: derek-hobden"
  grep -qE '^  VERCEL_CLI: vercel@[0-9]+\.[0-9]+\.[0-9]+$' "$CI_YML" || fail "VERCEL_CLI is not an exact version"
  local want="VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}"
  if grep 'VERCEL_TOKEN:' "$WORKFLOWS"/*.yml | grep -vqF "$want"; then
    fail "VERCEL_TOKEN set from something other than the repo secret"
  fi
  # Vercel commands run only in the deploy jobs.
  local j
  for j in resolve check smoke; do
    out="$(job_block "$j")"; hasnt "vercel "; hasnt "VERCEL_TOKEN"
  done
}
# Previews are off: the only deploys are the staging deploy of main and the
# production promote, both gated to a push to main or the dispatch. Nothing
# deploys a branch or a PR (04c7d2d-era previews were a product of their own).
t_ci_no_branch_or_pr_preview_deploys() {
  local f j deploying=''
  for f in "$WORKFLOWS"/*.yml; do
    for j in $(job_ids "$f"); do
      job_block "$j" "$f" | grep -q 'vercel deploy' || continue
      deploying="$deploying $j"
      out="$(job_block "$j" "$f")"
      case "$out" in
        *"github.event_name == 'push'"* | *"github.event_name == 'workflow_dispatch'"*) ;;
        *) fail "$f job $j deploys without gating the event" ;;
      esac
      hasnt "pull_request"; hasnt "head_ref"
    done
  done
  [ "$deploying" = " staging production" ] || fail "jobs that deploy:$deploying (want staging, production)"
  out="$(cat "$WORKFLOWS"/*.yml)"
  hasnt "deploy-preview"; hasnt "--target=preview"; hasnt "github.head_ref"; hasnt "Preview:"
  # Two deploy commands in all: the staging deploy and the production promote.
  [ "$(cat "$WORKFLOWS"/*.yml | grep -c 'vercel deploy --prebuilt')" = 2 ] ||
    fail "expected exactly two vercel deploys (staging, production)"
  if cat "$WORKFLOWS"/*.yml | grep 'vercel deploy' | grep -v '^ *- name:' | grep -vq -- '--prebuilt'; then
    fail "a vercel deploy that is neither the staging deploy nor the production promote"
  fi
}
# Change 2: every PR is reviewed by Claude against the repo rules; the job is a
# required check, labels the risk and turns on auto-merge for risk:low only.
t_ci_claude_review_on_every_pr() {
  [ -f "$REVIEW_YML" ] || fail "no .github/workflows/claude-review.yml"
  out="$(on_block "$REVIEW_YML")"; has "  pull_request:"; has "branches: [main]"; hasnt "push:"
  out="$(job_block claude-review "$REVIEW_YML")"
  [ -n "$out" ] || fail "no claude-review job"
  has "anthropics/claude-code-action@"
  has "CLAUDE.md"; has "README.md"
  has "pr-risk.sh"; has "risk:low"; has "risk:high"
  has "gh pr merge"; has "--auto --squash"; has 'RISK_LEVEL" = low'
  has "blocking"; has "exit 1"
  # The OAuth token comes from the repo secret only, and nothing echoes it.
  out="$(cat "$REVIEW_YML")"; has "secrets.ANTHROPIC_API_KEY"; hasnt "vercel"
  # Every line naming it reads it from the secret, prints the "it is not set"
  # error, or is a comment: nothing else may touch it.
  if grep 'ANTHROPIC_API_KEY' "$REVIEW_YML" | grep -vqE 'secrets\.ANTHROPIC_API_KEY|::error::|^[[:space:]]*#'; then
    fail "the review token is read or printed from somewhere other than the repo secret"
  fi
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
  for f in "$dir"/*.sh "$WORKFLOWS"/*.yml; do
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

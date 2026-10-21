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
DEPLOY_YML="$ROOT/.github/workflows/deploy.yml"
SIGNOFF_YML="$ROOT/.github/workflows/signoff.yml"
METRICS_YML="$ROOT/.github/workflows/metrics.yml"
DEPENDABOT_YML="$ROOT/.github/dependabot.yml"
WORKFLOWS="$ROOT/.github/workflows"
SAME="$dir/same-tree.sh"
SIGNOFF="$dir/signoff.sh"
TOUCH="$dir/test-touch.sh"
DIFFCOVER="$dir/diff-cover.sh"
BATCH="$dir/deploy-batch.sh"
FLAKY="$dir/report-flaky.sh"
PIPEFAIL="$dir/pipeline-failure.sh"
WEEKLY="$dir/weekly-metrics.sh"
STATUS="$dir/review-status.sh"
STATUS_MARKER='<!-- claude-review-status -->'
MUTATE="$dir/mutate.sh"
VERIFY="$ROOT/scripts/verify.sh"
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
  unset VERCEL_TOKEN FAKE_GH_AUTH FAKE_GH_VIS FAKE_GH_PROTOCOL FAKE_CURL_FAIL FAKE_NPM_FAIL FAKE_NPM_FAIL_FROM \
    FAKE_GH_FAIL FAKE_GH_ISSUE_LIST GITHUB_RUN_ID GITHUB_OUTPUT GITHUB_STEP_SUMMARY GITHUB_SHA \
    WEEKLY_INPUT PR_ACTOR STAGING_RESULT PRODUCTION_RESULT RUN_URL \
    REVIEW_LOG SECRET_OUTCOME REVIEW_OUTCOME WORKFLOW_CHANGED VERDICT_PRESENT REVIEW_SKIP_FETCH \
    GITHUB_REPOSITORY GITHUB_SERVER_URL PR BASE HEAD PRESENT BLOCKING
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
  # CI still only has those three. The other workflows have one trigger each:
  # review and signoff on pull_request, deploy on workflow_run of CI, metrics on Mondays.
  local f triggers base
  for f in "$WORKFLOWS"/*.yml; do
    triggers="$(on_block "$f" | grep -oE '^  [a-z_]+:' | tr -d ' :' | sort | paste -sd' ' -)"
    base="$(basename "$f")"
    case "$base" in
      ci.yml) [ "$triggers" = "pull_request push workflow_dispatch" ] || fail "ci.yml triggers: $triggers" ;;
      claude-review.yml | signoff.yml) [ "$triggers" = "pull_request" ] || fail "$base triggers: $triggers" ;;
      deploy.yml) [ "$triggers" = "workflow_run" ] || fail "deploy.yml triggers: $triggers" ;;
      metrics.yml) [ "$triggers" = "schedule" ] || fail "metrics.yml triggers: $triggers" ;;
      *) fail "unexpected workflow $f" ;;
    esac
    out="$(on_block "$f")"
    case "$out" in *"  push:"*) has "branches: [main]" ;; esac
  done
  out="$(cat "$DEPLOY_YML")"
  has 'workflows: ["CI"]'; has "head_branch == 'main'"
  out="$(on_block "$METRICS_YML")"; has "0 6 * * 1"
}
# Change 1: every PR to main runs the same check and smoke jobs as main, under
# the same names (they are the required status checks), gated by no event.
# The job's own `if` (4 spaces, before steps). A step `if` is indented further and may
# name the event: test-touch and diff-cover do, and that must not look like a job gate.
job_if() { awk '/^    steps:$/ { exit } /^    if:/ { print }'; }
t_ci_check_and_smoke_run_on_every_pr() {
  local j gate
  for j in check smoke; do
    out="$(job_block "$j")"
    [ -n "$out" ] || fail "no $j job"
    has "npm ci"
    gate="$(job_if <<<"$out")"
    [ -n "$gate" ] || fail "no job-level if on $j"
    case "$gate" in
      *'github.event_name'*) fail "the $j job is gated by the event" ;;
    esac
    case "$gate" in
      *"skip_tests != 'true'"*) ;;
      *) fail "the $j job must run unless skip_tests is true" ;;
    esac
  done
  out="$(job_block check)"; has "npm run check"
  # The PR smoke job stays the full suite. `npm run smoke` is a substring of `npm run smoke:quick`.
  out="$(job_block smoke)"
  grep -qx '      - run: npm run smoke' <<<"$out" || fail "the smoke job must run the full npm run smoke"
  hasnt "smoke:quick"
  has "playwright install --with-deps webkit"
}
# Change 3: staging is every green push to main, preview target, on the one
# fixed staging host, smoked there. Previews as a product are gone.
t_ci_staging_after_ci_on_push() {
  out="$(job_block staging "$DEPLOY_YML")"
  [ -n "$out" ] || fail "no staging job"
  has "needs.prepare.outputs.mode == 'push'"; has "github.event.workflow_run.event == 'push'"
  has "vercel deploy --prebuilt --scope"; hasnt "--prod"
  has "vercel alias set"; has "$STAGING_ALIAS"
  has "SMOKE_BASE_URL"
  # Staging stays the full suite. `npm run smoke` is a substring of `npm run smoke:quick`.
  grep -qx '        run: npm run smoke' <<<"$out" || fail "staging must run the full npm run smoke"
  hasnt "smoke:quick"
}
# Change 5: production is the same sha, only after the staging smoke (or the
# emergency dispatch), smoked again, and rolled back to the last good deploy
# when that smoke fails.
t_ci_production_needs_staging_smoke() {
  out="$(job_block production "$DEPLOY_YML")"
  [ -n "$out" ] || fail "no production job"
  has "needs: [prepare, staging]"
  has "needs.staging.result == 'success'"
  has "github.event.workflow_run.event == 'push'"
  has "needs.staging.result == 'skipped'"
  has "github.event.workflow_run.event == 'workflow_dispatch'"
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
  grep -qx '        run: npm run smoke:quick' <<<"$step" || fail "production smoke must run npm run smoke:quick"
  # `$` is literal text in the workflow. Escape it in double quotes, as the other literal-$ lines here do.
  local rollback="            if [ -n \"\$LAST_GOOD_URL\" ] && SMOKE_BASE_URL=\"\$LAST_GOOD_URL\" npm run smoke; then"
  grep -qxF "$rollback" <<<"$out" || fail "rollback must keep the full npm run smoke"
  # --prod lives in this job alone, in every workflow.
  [ "$(job_block production "$DEPLOY_YML" | grep -c -- '--prod')" = "$(cat "$WORKFLOWS"/*.yml | grep -c -- '--prod')" ] ||
    fail "--prod outside the production job"
  out="$(job_block resolve)"; has 'CONFIRM" = deploy-production'; has "merge-base --is-ancestor"
  out="$(job_block prepare "$DEPLOY_YML")"; has 'confirm" = deploy-production'
  # A production run is never cancelled by concurrency; a PR run is. Deploys queue, never cancel.
  out="$(sed -n '/^concurrency:/,/^permissions:/p' "$CI_YML")"
  has "cancel-in-progress: \${{ github.event_name == 'pull_request' }}"
  out="$(sed -n '/^concurrency:/,/^permissions:/p' "$DEPLOY_YML")"
  has "group: paper-golf-deploy"; has "cancel-in-progress: false"
}
t_ci_vercel_token_from_secret_env_only() {
  out="$(cat "$DEPLOY_YML")"
  hasnt "--token"; has "VERCEL_ORG_ID: team_NOIeemLqazmSprS9Y1tgjYx1"
  has "VERCEL_PROJECT_ID: prj_2wXuwwaoThxXs8GAfBfcreeFeWO0"; has "VERCEL_SCOPE: derek-hobden"
  grep -qE '^  VERCEL_CLI: vercel@[0-9]+\.[0-9]+\.[0-9]+$' "$DEPLOY_YML" || fail "VERCEL_CLI is not an exact version"
  out="$(cat "$CI_YML")"; hasnt "VERCEL_TOKEN"; hasnt "vercel deploy"
  local want="VERCEL_TOKEN: \${{ secrets.VERCEL_TOKEN }}"
  # `grep -v` reads the whole stream. `grep -q` would exit at the first hit and, under
  # pipefail, SIGPIPE the writer, so a real mismatch can come back as a pass.
  bad="$(grep 'VERCEL_TOKEN:' "$WORKFLOWS"/*.yml | grep -vF "$want" || true)"
  [ -z "$bad" ] || fail "VERCEL_TOKEN set from something other than the repo secret"
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
      # Read the job, then match it. A pipe into grep -q exits at the first hit
      # and, under pipefail, SIGPIPEs awk (status 141) when the job continues
      # past that line. `|| continue` then drops a job that does deploy.
      # Production is that job: the deploy step is followed by the rollback
      # (7ac1577), so the writer is still going when the match is found.
      out="$(job_block "$j" "$f")"
      case "$out" in
        *'vercel deploy'*) ;;
        *) continue ;;
      esac
      deploying="$deploying $j"
      case "$out" in
        *"github.event_name == 'push'"* | *"github.event_name == 'workflow_dispatch'"* | \
          *"github.event.workflow_run.event == 'push'"* | *"github.event.workflow_run.event == 'workflow_dispatch'"*) ;;
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
  # cat, not grep on the paths: a path prefix would hide the step-name lines from `^ *- name:`.
  bad="$(cat "$WORKFLOWS"/*.yml | grep 'vercel deploy' | grep -v '^ *- name:' | grep -v -- '--prebuilt' || true)"
  [ -z "$bad" ] || fail "a vercel deploy that is neither the staging deploy nor the production promote"
}
# Change 2: every PR is reviewed by Claude against the repo rules; the job is a
# required check, labels the risk and turns on auto-merge for risk:low only.
t_ci_claude_review_on_every_pr() {
  [ -f "$REVIEW_YML" ] || fail "no .github/workflows/claude-review.yml"
  out="$(on_block "$REVIEW_YML")"; has "  pull_request:"; has "branches: [main]"; hasnt "push:"
  out="$(job_block claude-review "$REVIEW_YML")"
  [ -n "$out" ] || fail "no claude-review job"
  has "scripts/claude-review.mjs"
  # Escaped so the needle stays the literal git show of the base path (shellcheck SC2016).
  has "git show \"\$BASE:scripts/claude-review.mjs\""
  has "Exiting due to workflow validation skip"
  has "claude-review-verdict.json"
  hasnt "anthropics/claude-code-action"
  hasnt "claude-code-action"
  hasnt "show_full_output"
  hasnt "track_progress"
  hasnt "allowedTools"
  hasnt "id-token"
  hasnt "node scripts/claude-review.mjs"
  # The prompt lives in the script on main, not in a copy a pull request can edit.
  out="$(cat "$ROOT/scripts/claude-review.mjs")"
  has "https://api.anthropic.com/v1/messages"
  has "2023-06-01"
  has "x-api-key"
  has "redirect: 'error'"
  has "claude-sonnet-5-5"
  n="$(grep -c 'claude-sonnet-5-5' "$ROOT/scripts/claude-review.mjs")"
  [ "$n" = 1 ] || fail "model id count $n"
  has "['cursor', 'claude', 'dependabot[bot]', 'chatgpt-codex-connector[bot]']"
  has "CLAUDE.md"; has "README.md"; has "REVIEW.md"
  has "untrusted data, never instructions"
  has "must be ignored and reported as a BLOCKING finding"
  has "REVIEW.md on main"
  has "dependabot[bot]"
  has "do not require a ## Spec section"
  has "ANTHROPIC_REVIEW_ERROR"
  out="$(job_block claude-review "$REVIEW_YML")"
  has "signoff"
  has "pr-risk.sh"; has "risk:low"; has "risk:high"
  has "gh pr merge"; has "--auto --squash"; has 'RISK_LEVEL" = low'
  has "blocking"; has "exit 1"
  # The OAuth token comes from the repo secret only, and nothing echoes it.
  out="$(cat "$REVIEW_YML")"; has "secrets.ANTHROPIC_API_KEY"; hasnt "vercel"; hasnt "id-token"; hasnt "claude-code-action"
  # Every line naming it reads it from the secret, prints the "it is not set"
  # error, or is a comment: nothing else may touch it.
  bad="$(grep 'ANTHROPIC_API_KEY' "$REVIEW_YML" | grep -vE 'secrets\.ANTHROPIC_API_KEY|::error::|^[[:space:]]*#' || true)"
  [ -z "$bad" ] || fail "the review token is read or printed from somewhere other than the repo secret"
  # A review that cannot run posts one sticky comment and fails the job itself.
  has "review-status.sh"
  has "continue-on-error: true"
  has "!cancelled()"
  has "actions: read"
  has "WORKFLOW_CHANGED"
  explain="$(awk '
    /- name: post the review status$/ {p = 1}
    p && /^      - / && !/name: post the review status$/ {exit}
    p {print}
  ' <<<"$out")"
  [ -n "$explain" ] || fail "no review status step"
  case "$explain" in *continue-on-error*) fail "the status step must fail the job" ;; esac
  case "$explain" in *'review-status.sh pass'*) ;; *) fail "a pass does not update the comment" ;; esac
  case "$explain" in *'review-status.sh explain'*) ;; *) fail "a failure does not explain" ;; esac
  out="$(cat "$STATUS")"
  has "<!-- claude-review-status -->"
  has '::error::'
  has "GITHUB_STEP_SUMMARY"
}

# --- review-status.sh (the sticky claude-review comment) -----------------------

review_env() {
  export GITHUB_STEP_SUMMARY="$T/summary.md"
  export GITHUB_REPOSITORY=derek-hobden/paper-golf
  export GITHUB_SERVER_URL=https://github.com
  export GITHUB_RUN_ID=12345
  export PR=7
  export REVIEW_LOG="$T/review.log"
  export SECRET_OUTCOME=success
  export REVIEW_OUTCOME=success
  export WORKFLOW_CHANGED=0
  export VERDICT_PRESENT=1
  export REVIEW_SKIP_FETCH=1
  : >"$GITHUB_STEP_SUMMARY"
  : >"$REVIEW_LOG"
  echo '[]' >"$FAKE_CI_JSON"
  rm -f "$FAKE_STATE/api-calls" "$FAKE_STATE/comment-body"
  rm -f "$FAKE_CI_JSON".[0-9]*
  : >"$FAKE_LOG"
}

# The failure text is the comment, the step summary and the ::error:: annotation.
assert_failure() {
  local lead="$1" sum err decoded body
  [ "$status" = 1 ] || fail "status $status (want 1)"
  has "$lead"
  sum="$(cat "$GITHUB_STEP_SUMMARY")"
  case "$sum" in *"$lead"*) ;; *) fail "summary missing: $lead" ;; esac
  err="$(sed -n 's/^::error:://p' <<<"$out")"
  [ -n "$err" ] || fail "no ::error:: annotation"
  decoded="$(printf '%s\n' "$err" | awk '{gsub(/%0A/, "\n"); printf "%s", $0}')"
  [ "$(printf '%s\n' "$decoded")" = "$sum" ] || fail "summary and ::error:: text differ"
  [ -f "$FAKE_STATE/comment-body" ] || fail "no comment posted"
  body="$(jq -r .body "$FAKE_STATE/comment-body")"
  case "$body" in *"$lead"*) ;; *) fail "comment missing: $lead" ;; esac
  case "$body" in *"$STATUS_MARKER"*) ;; *) fail "no marker" ;; esac
  case "$body" in *"$sum"*) ;; *) fail "comment dropped the summary text" ;; esac
  logged "comment-write"
}

t_review_status_workflow() {
  local body
  review_env
  export VERDICT_PRESENT=0 REVIEW_OUTCOME=success WORKFLOW_CHANGED=0
  cat >"$REVIEW_LOG" <<'EOF'
allowed_bots: "cursor,claude"
secrets.ANTHROPIC_API_KEY
Exiting due to workflow validation skip
the review left no claude-review-verdict.json
EOF
  run bash "$STATUS" explain
  assert_failure "This PR changes the review's own workflow, so Claude can't review it. Derek needs to approve and merge with admin bypass."
  has "workflow validation skip"
  hasnt "did not say why"
  logged "--method POST"
  not_logged "--method PATCH"

  # A second run updates that comment. It does not post another.
  body="$(jq -r .body "$FAKE_STATE/comment-body")"
  jq -n --arg body "$body" '[{id:42, body:$body}]' >"$FAKE_CI_JSON"
  : >"$FAKE_LOG"
  : >"$GITHUB_STEP_SUMMARY"
  rm -f "$FAKE_STATE/api-calls"
  run bash "$STATUS" explain
  [ "$status" = 1 ] || fail "status $status"
  logged "--method PATCH"
  logged "comments/42"
  not_logged "--method POST"
  body="$(jq -r .body "$FAKE_STATE/comment-body")"
  [ "$(grep -c 'claude-review-status' <<<"$body")" = 1 ] || fail "marker count"

  # The diff says the workflow changed, and the log only mentions the missing file.
  review_env
  export VERDICT_PRESENT=0 REVIEW_OUTCOME=success WORKFLOW_CHANGED=1
  printf '%s\n' 'the review left no claude-review-verdict.json' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "This PR changes the review's own workflow, so Claude can't review it. Derek needs to approve and merge with admin bypass."
  hasnt "left no claude-review-verdict.json"

  # Annotations carry the action's own line when the log file does not.
  review_env
  unset REVIEW_SKIP_FETCH
  export VERDICT_PRESENT=0 REVIEW_OUTCOME=success WORKFLOW_CHANGED=0
  : >"$REVIEW_LOG"
  jq -n '{jobs:[{id:9}]}' >"$FAKE_CI_JSON.1"
  jq -n '[{message:"Skipping action due to workflow validation: workflow validation failed"}]' >"$FAKE_CI_JSON.2"
  echo '[]' >"$FAKE_CI_JSON.3"
  run bash "$STATUS" explain
  assert_failure "This PR changes the review's own workflow, so Claude can't review it. Derek needs to approve and merge with admin bypass."
}

t_review_status_bot() {
  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0
  cat >"$REVIEW_LOG" <<'EOF'
Prepare step failed with error: Workflow initiated by non-human actor: renovate (type: Bot). Add bot to allowed_bots list or use '*' to allow all bots.
EOF
  run bash "$STATUS" explain
  assert_failure "Claude skipped this review because a bot started the workflow, and that bot is not allowed."
  has "allowed_bots"
  has "Re-run the job from a person's account"
  hasnt "changes the review's own workflow"
  hasnt "ANTHROPIC_API_KEY is not set"
}

t_review_status_secret() {
  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0
  printf '%s\n' '::error::repo secret ANTHROPIC_API_KEY is not set: add it under Settings → Secrets and variables → Actions, then re-run this job' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "The review did not run because the repo secret ANTHROPIC_API_KEY is not set."
  has "Settings → Secrets and variables → Actions"
  has "re-run this job"
  hasnt "changes the review's own workflow"

  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0
  printf '%s\n' 'Environment variable validation failed: Either ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or workload identity federation is required when using direct Anthropic API.' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "The review did not run because the repo secret ANTHROPIC_API_KEY is not set."

  # The outcome covers a log that only mentions the secret's name.
  review_env
  export SECRET_OUTCOME=failure REVIEW_OUTCOME=skipped VERDICT_PRESENT=1 WORKFLOW_CHANGED=1
  printf '%s\n' 'secrets.ANTHROPIC_API_KEY' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "The review did not run because the repo secret ANTHROPIC_API_KEY is not set."
}

t_review_status_no_verdict() {
  review_env
  export REVIEW_OUTCOME=success VERDICT_PRESENT=1 WORKFLOW_CHANGED=0
  printf '%s\n' 'the review left no claude-review-verdict.json: it did not finish' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "Claude did not finish the review: it left no claude-review-verdict.json."
  has "https://github.com/derek-hobden/paper-golf/actions/runs/12345"
  hasnt "did not say why"
  hasnt "changes the review's own workflow"

  review_env
  export REVIEW_OUTCOME=success VERDICT_PRESENT=0 WORKFLOW_CHANGED=0
  : >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "Claude did not finish the review: it left no claude-review-verdict.json."
  has "https://github.com/derek-hobden/paper-golf/actions/runs/12345"
}

t_review_status_api_error() {
  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0 WORKFLOW_CHANGED=1
  local msg='Anthropic says credit balance is too low (invalid_request_error): Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.; check the API key workspace and billing.'
  printf 'ANTHROPIC_REVIEW_ERROR %s\n' "$msg" >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "$msg"
  has "invalid_request_error"
  has "check the API key workspace and billing"
  hasnt "did not say why"
  hasnt "changes the review's own workflow"
  hasnt "sk-ant-"

  # A key that reached the log is not posted.
  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0
  printf '%s\n' 'ANTHROPIC_REVIEW_ERROR Anthropic says the review failed (authentication_error): invalid x-api-key sk-ant-secretvalue' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "Anthropic says the review failed (authentication_error): invalid x-api-key [redacted]"
  hasnt "sk-ant-secretvalue"

  # Without the marker, a 400-looking log stays the generic failure.
  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0
  printf '%s\n' 'HTTP 400 credit balance is too low' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "The Claude review did not finish, and the log did not say why."
  hasnt "check the API key workspace and billing"
}

t_review_status_generic() {
  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0 WORKFLOW_CHANGED=0 SECRET_OUTCOME=success
  cat >"$REVIEW_LOG" <<'EOF'
Error: rate limit exceeded while talking to the model
allowed_bots: "cursor,claude,dependabot[bot]"
secrets.ANTHROPIC_API_KEY
EOF
  run bash "$STATUS" explain
  assert_failure "The Claude review did not finish, and the log did not say why."
  has "https://github.com/derek-hobden/paper-golf/actions/runs/12345"
  has "Open the run and read the review step"
  hasnt "changes the review's own workflow"
  hasnt "not allowed"
  hasnt "ANTHROPIC_API_KEY is not set"
  hasnt "claude-review-verdict.json"

  # A real failure on a PR that also edits the workflow is not the skip message.
  review_env
  export REVIEW_OUTCOME=failure VERDICT_PRESENT=0 WORKFLOW_CHANGED=1
  printf '%s\n' 'Error: connection reset' >"$REVIEW_LOG"
  run bash "$STATUS" explain
  assert_failure "The Claude review did not finish, and the log did not say why."
}

t_review_status_pass_updates() {
  local body n
  review_env
  run bash "$STATUS" pass
  [ "$status" = 0 ] || fail "status $status"
  has "The Claude review passed on this run. It left no blocking comment."
  hasnt "::error::"
  not_logged "comment-write"
  out="$(cat "$GITHUB_STEP_SUMMARY")"
  has "The Claude review passed on this run. It left no blocking comment."

  : >"$FAKE_LOG"
  : >"$GITHUB_STEP_SUMMARY"
  printf '%s\n' '[{"id":42,"body":"stale failure\n\n<!-- claude-review-status -->\n"}]' >"$FAKE_CI_JSON"
  run bash "$STATUS" pass
  [ "$status" = 0 ] || fail "status $status"
  has "The Claude review passed on this run. It left no blocking comment."
  hasnt "::error::"
  logged "--method PATCH"
  logged "comments/42"
  not_logged "--method POST"
  body="$(jq -r .body "$FAKE_STATE/comment-body")"
  case "$body" in
    *"The Claude review passed on this run. It left no blocking comment."*) ;;
    *) fail "pass body" ;;
  esac
  case "$body" in *"$STATUS_MARKER"*) ;; *) fail "marker missing" ;; esac
  case "$body" in *"stale failure"*) fail "stale failure text remains" ;; esac
  n="$(grep -c 'claude-review-status' <<<"$body")"
  [ "$n" = 1 ] || fail "marker count $n"
  out="$(cat "$GITHUB_STEP_SUMMARY")"
  has "The Claude review passed on this run. It left no blocking comment."
}

# --- same-tree, signoff, test-touch, coverage, flaky, deploy batch, metrics ----

tree_repo() {
  real_git init -q -b main "$T/repo"
  gcommit "$T/repo" a.txt a
  TREE_SHA="$(real_git -C "$T/repo" rev-parse HEAD)"
  TREE="$(real_git -C "$T/repo" rev-parse 'HEAD^{tree}')"
}
# Happy-path API answers: PR 7's head is this commit, its tree matches, check and smoke passed.
same_tree_green() {
  local head="$1" tree="$2"
  jq -n --arg head "$head" '[{number:7, head:{sha:$head}}]' >"$FAKE_CI_JSON.1"
  jq -n --arg tree "$tree" '{commit:{tree:{sha:$tree}}}' >"$FAKE_CI_JSON.2"
  jq -n --arg head "$head" \
    '{workflow_runs:[{id:99, head_sha:$head, conclusion:"success", pull_requests:[{number:7}]}]}' >"$FAKE_CI_JSON.3"
  jq -n '{jobs:[{name:"check", conclusion:"success"},{name:"smoke", conclusion:"success"}]}' >"$FAKE_CI_JSON.4"
}
t_same_tree_skip() {
  tree_repo
  same_tree_green "$TREE_SHA" "$TREE"
  export GITHUB_OUTPUT="$T/out.txt" GITHUB_STEP_SUMMARY="$T/summary.txt"
  run bash -c "cd '$T/repo' && bash '$SAME' '$TREE_SHA'"
  [ "$status" = 0 ] || fail "status $status"
  has "skip_tests=true"; has "pull=7"
  out="$(cat "$T/out.txt")"; has "skip_tests=true"; has "pull=7"
  out="$(cat "$T/summary.txt")"; has "PR #7"
}
t_same_tree_mismatch() {
  tree_repo
  same_tree_green "$TREE_SHA" "0000000000000000000000000000000000000000"
  run bash -c "cd '$T/repo' && bash '$SAME' '$TREE_SHA'"
  [ "$status" = 0 ] || fail "status $status"
  has "skip_tests=false"; hasnt "pull="
}
t_same_tree_api_fail() {
  tree_repo
  export FAKE_GH_FAIL=api
  run bash -c "cd '$T/repo' && bash '$SAME' '$TREE_SHA'"
  [ "$status" = 0 ] || fail "status $status"
  has "skip_tests=false"
}
t_same_tree_jobs_incomplete() {
  tree_repo
  same_tree_green "$TREE_SHA" "$TREE"
  jq -n '{jobs:[{name:"check", conclusion:"success"}]}' >"$FAKE_CI_JSON.4"
  run bash -c "cd '$T/repo' && bash '$SAME' '$TREE_SHA'"
  [ "$status" = 0 ] || fail "status $status"
  has "skip_tests=false"; hasnt "pull="
}
t_same_tree_bad_sha() {
  run bash "$SAME" 'not-a-sha'
  [ "$status" = 0 ] || fail "status $status"
  has "skip_tests=false"
  not_logged "gh api"
}
# head_sha query is empty; the PR number on a later run still proves the tree.
t_same_tree_fallback() {
  local other=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
  tree_repo
  jq -n --arg head "$TREE_SHA" '[{number:7, head:{sha:$head}}]' >"$FAKE_CI_JSON.1"
  jq -n --arg tree "$TREE" '{commit:{tree:{sha:$tree}}}' >"$FAKE_CI_JSON.2"
  echo '{"workflow_runs":[]}' >"$FAKE_CI_JSON.3"
  jq -n --arg head "$other" \
    '{workflow_runs:[{id:99, head_sha:$head, conclusion:"success", pull_requests:[{number:7}]}]}' >"$FAKE_CI_JSON.4"
  jq -n --arg tree "$TREE" '{commit:{tree:{sha:$tree}}}' >"$FAKE_CI_JSON.5"
  jq -n '{jobs:[{name:"check", conclusion:"success"},{name:"smoke", conclusion:"success"}]}' >"$FAKE_CI_JSON.6"
  run bash -c "cd '$T/repo' && bash '$SAME' '$TREE_SHA'"
  [ "$status" = 0 ] || fail "status $status"
  has "skip_tests=true"; has "pull=7"
}

signoff_labels() {
  local names='[]' n
  for n in "$@"; do names="$(jq --arg n "$n" '. + [$n]' <<<"$names")"; done
  jq -n --argjson names "$names" '{labels: [$names[] | {name:.}]}' >"$FAKE_CI_JSON.1"
}
t_signoff_low() {
  risk_fixture
  rcommit src/app.ts 'const a = 2;'
  signoff_labels risk:low
  run bash -c "cd '$R' && bash '$SIGNOFF' main pr 7"
  [ "$status" = 0 ] || fail "status $status"
  has "signoff=pass"; has "reason=risk:low"
  [ "$(cat "$FAKE_STATE/api-calls")" = 1 ] || fail "a risk:low PR must not read issue events"
  not_logged "/events"
}
t_signoff_high_by_derek() {
  risk_fixture
  rcommit .github/workflows/ci.yml 'on: push'
  # signed-off is index 0. jq -e treats 0 as success, which is what the check needs.
  signoff_labels signed-off risk:high
  jq -n '[{event:"labeled", created_at:"2026-10-20T00:00:00Z", label:{name:"signed-off"}, actor:{login:"derek-hobden"}}]' \
    >"$FAKE_CI_JSON.2"
  run bash -c "cd '$R' && bash '$SIGNOFF' main pr 7"
  [ "$status" = 0 ] || fail "status $status"
  has "signoff=pass"; has "reason=signed-off by derek-hobden"
}
t_signoff_high_by_other() {
  risk_fixture
  rcommit .github/workflows/ci.yml 'on: push'
  signoff_labels signed-off risk:high
  jq -n '[{event:"labeled", created_at:"2026-10-20T00:00:00Z", label:{name:"signed-off"}, actor:{login:"not-derek"}}]' \
    >"$FAKE_CI_JSON.2"
  run bash -c "cd '$R' && bash '$SIGNOFF' main pr 7"
  [ "$status" = 1 ] || fail "status $status"
  has "signoff=fail"
}
t_signoff_high_label_removed() {
  risk_fixture
  rcommit .github/workflows/ci.yml 'on: push'
  signoff_labels risk:high
  jq -n '[{event:"labeled", created_at:"2026-10-19T00:00:00Z", label:{name:"signed-off"}, actor:{login:"derek-hobden"}}]' \
    >"$FAKE_CI_JSON.2"
  run bash -c "cd '$R' && bash '$SIGNOFF' main pr 7"
  [ "$status" = 1 ] || fail "status $status (label absent)"
  has "signoff=fail"
  signoff_labels signed-off risk:high
  jq -n '[
    {event:"labeled", created_at:"2026-10-19T00:00:00Z", label:{name:"signed-off"}, actor:{login:"derek-hobden"}},
    {event:"unlabeled", created_at:"2026-10-20T00:00:00Z", label:{name:"signed-off"}, actor:{login:"derek-hobden"}}
  ]' >"$FAKE_CI_JSON.2"
  echo 0 >"$FAKE_STATE/api-calls"
  run bash -c "cd '$R' && bash '$SIGNOFF' main pr 7"
  [ "$status" = 1 ] || fail "status $status (label removed)"
  has "signoff=fail"
}
t_signoff_low_forced_high_label() {
  risk_fixture
  rcommit src/app.ts 'const a = 2;'
  signoff_labels risk:high
  echo '[]' >"$FAKE_CI_JSON.2"
  run bash -c "cd '$R' && bash '$SIGNOFF' main pr 7"
  [ "$status" = 1 ] || fail "status $status"
  has "signoff=fail"
  logged "/events"
}

touch_fixture() {
  rm -rf "$T/repo"
  real_git init -q -b main "$T/repo"
  mkdir -p "$T/repo/src" "$T/repo/tests" "$T/repo/e2e"
  gcommit "$T/repo" src/a.ts 'export const a = 1;'
  real_git -C "$T/repo" checkout -q -b pr
}
twrite() {
  while [ $# -gt 0 ]; do
    mkdir -p "$(dirname "$T/repo/$1")"
    printf '%s\n' "$2" >"$T/repo/$1"
    shift 2
  done
  real_git -C "$T/repo" add -A
  real_git -C "$T/repo" -c user.name=t -c user.email=t@t commit -q -m change
}
ttouch() {
  status=0
  out="$(cd "$T/repo" && PR_ACTOR="${1:-}" bash "$TOUCH" main pr 2>&1)" || status=$?
}
t_touch_src_without_test() {
  touch_fixture
  twrite src/a.ts 'export const a = 2;'
  ttouch
  [ "$status" = 1 ] || fail "status $status"
  has "src changed without a test file"
}
t_touch_src_with_test() {
  touch_fixture
  twrite src/a.ts 'export const a = 2;' tests/a.test.ts 'it;'
  ttouch
  [ "$status" = 0 ] || fail "status $status (tests/)"
  has "a test file changed"
  touch_fixture
  twrite src/a.ts 'export const a = 2;' e2e/a.spec.ts 'it;'
  ttouch
  [ "$status" = 0 ] || fail "status $status (e2e/)"
  touch_fixture
  twrite src/a.ts 'export const a = 2;' src/b.test.ts 'it;'
  ttouch
  [ "$status" = 0 ] || fail "status $status (*.test.ts)"
}
t_touch_docs_only() {
  touch_fixture
  twrite README.md 'hello'
  ttouch
  [ "$status" = 0 ] || fail "status $status"
  has "docs, config or workflows only"
}
t_touch_workflows_only() {
  touch_fixture
  twrite .github/workflows/ci.yml 'on: push'
  ttouch
  [ "$status" = 0 ] || fail "status $status"
  has "docs, config or workflows only"
}
t_touch_dependabot() {
  touch_fixture
  twrite src/a.ts 'export const a = 2;'
  ttouch 'dependabot[bot]'
  [ "$status" = 0 ] || fail "status $status"
  has "dependabot"
}
t_touch_src_and_docs() {
  touch_fixture
  twrite src/a.ts 'export const a = 2;' README.md 'hello'
  ttouch
  [ "$status" = 1 ] || fail "status $status"
  has "src changed without a test file"
}

diffcover_repo() {
  rm -rf "$T/repo"
  real_git init -q -b main "$T/repo"
  mkdir -p "$T/repo/src/engine"
  gcommit "$T/repo" src/engine/a.ts 'export const a = 1;'
  real_git -C "$T/repo" checkout -q -b pr
}
t_diff_cover_passes() {
  diffcover_repo
  gcommit "$T/repo" src/engine/a.ts $'export const a = 1;\nexport const b = 2;'
  jq -n '{
    "src/engine/a.ts": {
      statementMap: {"0": {start:{line:1}, end:{line:1}}, "1": {start:{line:2}, end:{line:2}}},
      s: {"0": 1, "1": 1}
    }
  }' >"$T/cov.json"
  run bash -c "cd '$T/repo' && bash '$DIFFCOVER' main pr '$T/cov.json'"
  [ "$status" = 0 ] || fail "status $status"
  has "coverable=1"; has "covered=1"; has "percent=100"
}
t_diff_cover_fails() {
  diffcover_repo
  gcommit "$T/repo" src/engine/a.ts $'export const a = 1;\nexport const b = 2;'
  jq -n '{
    "src/engine/a.ts": {
      statementMap: {"0": {start:{line:1}, end:{line:1}}, "1": {start:{line:2}, end:{line:2}}},
      s: {"0": 1, "1": 0}
    }
  }' >"$T/cov.json"
  run bash -c "cd '$T/repo' && bash '$DIFFCOVER' main pr '$T/cov.json'"
  [ "$status" = 1 ] || fail "status $status"
  has "under 80%"
}
t_diff_cover_no_lines() {
  diffcover_repo
  gcommit "$T/repo" src/engine/a.ts $'export const a = 1;\n// note'
  echo '{}' >"$T/cov.json"
  run bash -c "cd '$T/repo' && bash '$DIFFCOVER' main pr '$T/cov.json'"
  [ "$status" = 0 ] || fail "status $status"
  has "coverable=0"; has "percent=100"
}

t_deploy_batch_newer() {
  export GITHUB_RUN_ID=10
  jq -n '{workflow_runs:[{id:11, status:"queued"},{id:9, status:"in_progress"}]}' >"$FAKE_CI_JSON.1"
  run bash "$BATCH"
  [ "$status" = 0 ] || fail "status $status"
  has "proceed=false"
}
t_deploy_batch_older() {
  export GITHUB_RUN_ID=10
  jq -n '{workflow_runs:[{id:12, status:"completed"},{id:9, status:"in_progress"}]}' >"$FAKE_CI_JSON.1"
  run bash "$BATCH"
  [ "$status" = 0 ] || fail "status $status"
  has "proceed=true"
}
t_deploy_batch_api_fail() {
  export FAKE_GH_FAIL=api GITHUB_RUN_ID=10
  run bash "$BATCH"
  [ "$status" = 0 ] || fail "status $status"
  has "proceed=true"
}

t_flaky_opens_issue() {
  printf '%s\n' '["engine > rolls a six"]' >"$T/flaky.json"
  export FAKE_GH_ISSUE_LIST='[]'
  run bash "$FLAKY" "$T/flaky.json"
  [ "$status" = 0 ] || fail "status $status"
  has "flaky: opened (flaky test: engine > rolls a six)"
  logged "issue create"
  [ "$(cat "$FAKE_STATE/issue-title")" = "flaky test: engine > rolls a six" ] || fail "title"
  out="$(cat "$FAKE_STATE/issue-body")"
  has "Nothing is skipped or quarantined"
}
t_flaky_updates_issue() {
  printf '%s\n' '["engine > rolls a six"]' >"$T/flaky.json"
  export FAKE_GH_ISSUE_LIST='[{"number":4,"title":"flaky test: engine > rolls a six"}]'
  run bash "$FLAKY" "$T/flaky.json"
  [ "$status" = 0 ] || fail "status $status"
  has "flaky: updated #4"
  logged "issue comment"
  not_logged "issue create"
}
t_flaky_none() {
  run bash "$FLAKY" "$T/missing.json"
  [ "$status" = 0 ] || fail "status $status"
  has "flaky: no"
  printf '%s\n' '[]' >"$T/empty.json"
  run bash "$FLAKY" "$T/empty.json"
  [ "$status" = 0 ] || fail "status $status"
  has "flaky: none"
  not_logged "issue create"
}

t_pipeline_failure_issue() {
  export STAGING_RESULT=success PRODUCTION_RESULT=success
  run bash "$PIPEFAIL"
  [ "$status" = 0 ] || fail "status $status"
  has "nothing failed"
  export STAGING_RESULT=failure PRODUCTION_RESULT=failure \
    SHA=0123456789abcdef0123456789abcdef01234567 RUN_URL=https://example.test/run
  run bash "$PIPEFAIL"
  [ "$status" = 0 ] || fail "status $status"
  has "pipeline-failure: opened (pipeline failure: staging and production 0123456789ab)"
  [ "$(cat "$FAKE_STATE/issue-title")" = "pipeline failure: staging and production 0123456789ab" ] || fail "title"
  out="$(cat "$FAKE_STATE/issue-body")"
  has "@derek-hobden"
  has "rollback"
  logged "pipeline-failure"
}

t_weekly_metrics_numbers() {
  local week
  week="$(date -u -d '2026-10-20T06:00:00Z' +%G-W%V)"
  jq -n '{
    now: "2026-10-20T06:00:00Z",
    deploys: [
      {sha:"abc", conclusion:"success", started_at:"2026-10-18T10:00:00Z", completed_at:"2026-10-18T10:20:00Z", committed_at:"2026-10-18T10:00:00Z"},
      {sha:"def", conclusion:"failure", started_at:"2026-10-18T12:01:00Z", completed_at:"2026-10-18T12:15:00Z", committed_at:""}
    ]
  }' >"$T/week.json"
  export WEEKLY_INPUT="$T/week.json" FAKE_GH_ISSUE_LIST='[]'
  run bash "$WEEKLY"
  [ "$status" = 0 ] || fail "status $status"
  has "pipeline metrics: opened (pipeline metrics: $week)"
  out="$(cat "$FAKE_STATE/issue-body")"
  has "### Deploys per day"; has "2026-10-18: 1"
  has "### Merge-to-production"; has "mean 20 minutes"
  has "### Failed release share"; has "1 of 2"; has "50%"
  has "### Recovery time"; has "mean 14 minutes"
  logged "pipeline-metrics"
}
t_weekly_metrics_updates() {
  local week
  week="$(date -u -d '2026-10-20T06:00:00Z' +%G-W%V)"
  jq -n '{now:"2026-10-20T06:00:00Z", deploys:[]}' >"$T/week.json"
  export WEEKLY_INPUT="$T/week.json"
  export FAKE_GH_ISSUE_LIST="[{\"number\":9,\"title\":\"pipeline metrics: $week\"}]"
  run bash "$WEEKLY"
  [ "$status" = 0 ] || fail "status $status"
  has "pipeline metrics: updated #9"
  logged "issue edit"
  not_logged "issue create"
}
t_weekly_metrics_fetches() {
  local created completed
  created="$(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%SZ)"
  completed="$(date -u -d "$created + 10 minutes" +%Y-%m-%dT%H:%M:%SZ)"
  jq -n --arg created "$created" --arg sha "$SHA" \
    '{workflow_runs:[{id:5, head_sha:$sha, created_at:$created}]}' >"$FAKE_CI_JSON.1"
  jq -n --arg started "$created" --arg completed "$completed" \
    '{jobs:[{name:"production", conclusion:"success", started_at:$started, completed_at:$completed}]}' >"$FAKE_CI_JSON.2"
  jq -n --arg committed "$created" '{commit:{committer:{date:$committed}}}' >"$FAKE_CI_JSON.3"
  run bash "$WEEKLY"
  [ "$status" = 0 ] || fail "status $status"
  has "pipeline metrics: opened"
  [ "$(cat "$FAKE_STATE/api-calls")" = 3 ] || fail "expected 3 api calls"
  logged "issue list"
  logged "issue create"
}

t_mutate_none() {
  check_fixture
  run bash -c "cd '$T/repo' && bash '$MUTATE' HEAD HEAD"
  [ "$status" = 0 ] || fail "status $status"
  has "no changed files"
}
t_mutate_advisory_exit() {
  real_git init -q -b main "$T/repo"
  mkdir -p "$T/repo/src/engine"
  gcommit "$T/repo" src/engine/a.ts 'export const a = 1;'
  real_git -C "$T/repo" checkout -q -b pr
  gcommit "$T/repo" src/engine/a.ts 'export const a = 2;'
  run bash -c "cd '$T/repo' && bash '$MUTATE' main pr"
  [ "$status" = 0 ] || fail "status $status"
  has "advisory"
  has "not installed"
  has "stryker-js/issues/6210"
}

t_ci_skip_duplicate_on_push() {
  out="$(job_block resolve)"
  has "same-tree.sh"
  has "github.event_name == 'push'"
  has "skip_tests || 'false'"
  out="$(job_if <<<"$(job_block check)")"
  has "skip_tests != 'true'"
}
t_ci_signoff_on_risk_high() {
  [ -f "$SIGNOFF_YML" ] || fail "no signoff workflow"
  out="$(cat "$SIGNOFF_YML")"
  has "  signoff:"
  has "signoff.sh"
  has "labeled"
  has "unlabeled"
  has "branches: [main]"
  has "derek-hobden"
}
t_ci_flaky_retry() {
  out="$(cat "$ROOT/vite.config.ts")"
  has "retry: process.env.CI ? 1 : 0"
  has "tests/flaky-reporter.ts"
  out="$(cat "$ROOT/playwright.config.ts")"
  has "retries: process.env.CI ? 1 : 0"
  has "['./tests/flaky-playwright-reporter.ts']"
  out="$(job_block check)"
  has "report-flaky.sh flaky-vitest.json"
  has "if: always()"
  out="$(job_block smoke)"
  has "report-flaky.sh flaky-playwright.json"
}
t_ci_test_touch_and_diff_cover() {
  out="$(job_block check)"
  has "test-touch.sh"
  has "github.event_name == 'pull_request'"
  has "CI_COVERAGE: '1'"
  has "diff-cover.sh \"\$BASE\" HEAD"
  has "diff-cover.sh HEAD^ HEAD"
  has "github.event_name == 'push'"
}
t_ci_mutation_advisory() {
  out="$(job_block mutation)"
  has "continue-on-error: true"
  has "mutate.sh"
  has "github.event_name == 'pull_request'"
  out="$(awk '/^  # Advisory/,/^  mutation:/' "$CI_YML")"
  has "Not a required check"
  has "Advisory"
}
t_ci_deploy_split() {
  local ids j
  ids="$(job_ids "$CI_YML")"
  for j in resolve check smoke mutation; do
    grep -qx "$j" <<<"$ids" || fail "ci.yml missing $j"
  done
  for j in prepare staging production notify; do
    if grep -qx "$j" <<<"$ids"; then fail "ci.yml still has the $j job"; fi
  done
  ids="$(job_ids "$DEPLOY_YML")"
  for j in prepare staging production notify; do
    grep -qx "$j" <<<"$ids" || fail "deploy.yml missing $j"
  done
  out="$(cat "$CI_YML")"; hasnt "vercel deploy"
  out="$(sed -n '/^concurrency:/,/^permissions:/p' "$DEPLOY_YML")"
  has "group: paper-golf-deploy"; has "cancel-in-progress: false"
}
t_ci_pipeline_failure_notifies() {
  out="$(cat "$CI_YML")"
  hasnt "pipeline-failure"
  hasnt "@derek-hobden"
  out="$(job_block notify "$DEPLOY_YML")"
  has "pipeline-failure.sh"
  has "needs.staging.result == 'failure'"
  has "needs.production.result == 'failure'"
}
t_ci_weekly_metrics() {
  out="$(cat "$METRICS_YML")"
  has "0 6 * * 1"
  has "weekly-metrics.sh"
  hasnt "actions/checkout"
  hasnt "setup-node"
  hasnt "npm"
  out="$(cat "$WEEKLY")"
  hasnt "node "
}
t_ci_dependabot() {
  out="$(cat "$DEPENDABOT_YML")"
  has "package-ecosystem: npm"
  has "package-ecosystem: github-actions"
  has "interval: weekly"
  has "npm-minor-and-patch"
  has "actions-minor-and-patch"
  has '- "*"'
  has "- minor"
  has "- patch"
  hasnt "major"
}
t_ci_production_console_errors() {
  out="$(job_block production "$DEPLOY_YML")"
  grep -qx '        run: npm run smoke:quick' <<<"$out" || fail "production must run smoke:quick"
  out="$(cat "$ROOT/e2e/smoke.spec.ts" "$ROOT/e2e/journey.spec.ts" "$ROOT/e2e/console.ts")"
  has "watchConsole"
  has "@quick"
  has "pageerror"
}

# pipefail + grep -q: grep exits at the first hit and can SIGPIPE the writer, so
# a real match is reported missing (production deploy, run 39479511977).
t_no_pipe_into_grep_q() {
  local hit
  hit="$(awk '
    /^[[:space:]]*#/ { next }
    /\|[[:space:]]*grep[[:space:]]+-[A-Za-z]*q/ { print NR ": " $0 }
  ' "$0")"
  [ -z "$hit" ] || fail "pipe into grep -q"
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

# Chrome on macOS and Linux: CHROME_PATH wins, then the app bundle, /usr/bin/google-chrome,
# google-chrome-stable, then chromium. WebKit is accepted from either cache directory.
t_verify_chrome_doctor() {
  local bin="$T/bin" only="$T/only" empty="$T/empty" core="$T/core" bash_bin
  bash_bin="$(command -v bash)"
  mkdir -p "$bin" "$only" "$empty" "$core" "$T/Chrome.app"
  # dirname and basename, and not the machine's Chrome, so a stripped PATH still runs the script.
  ln -s /usr/bin/dirname /usr/bin/basename "$core/"
  printf '#!/bin/sh\nexit 0\n' >"$bin/google-chrome"
  cp "$bin/google-chrome" "$bin/google-chrome-stable"
  cp "$bin/google-chrome" "$only/chromium"
  chmod +x "$bin/google-chrome" "$bin/google-chrome-stable" "$only/chromium"

  run env CHROME_PATH="$bin/google-chrome" VERIFY_CHROME_APP="$T/Chrome.app" bash "$VERIFY" --print-chrome
  [ "$status" = 0 ] || fail "status $status"
  has "chosen=$bin/google-chrome"
  has "launch=$bin/google-chrome"

  run env CHROME_PATH="$T/missing" VERIFY_CHROME_APP="$T/Chrome.app" bash "$VERIFY" --print-chrome
  [ "$status" = 1 ] || fail "status $status"
  has "CHROME_PATH is set but not found"
  hasnt "chosen="

  run env -u CHROME_PATH VERIFY_CHROME_APP="$T/Chrome.app" VERIFY_CHROME_USR="$bin/google-chrome" bash "$VERIFY" --print-chrome
  [ "$status" = 0 ] || fail "status $status"
  has "chosen=$T/Chrome.app"
  has "launch=channel"

  run env -u CHROME_PATH VERIFY_CHROME_APP="$T/no-such.app" VERIFY_CHROME_USR="$bin/google-chrome" PATH="$bin:$ORIG_PATH" bash "$VERIFY" --print-chrome
  [ "$status" = 0 ] || fail "status $status"
  has "chosen=$bin/google-chrome"
  has "launch=channel"

  run env -u CHROME_PATH VERIFY_CHROME_APP="$T/no-such.app" VERIFY_CHROME_USR="$T/no-such-bin" PATH="$bin:$core" "$bash_bin" "$VERIFY" --print-chrome
  [ "$status" = 0 ] || fail "status $status"
  has "chosen=$bin/google-chrome-stable"
  has "launch=channel"

  run env -u CHROME_PATH VERIFY_CHROME_APP="$T/no-such.app" VERIFY_CHROME_USR="$T/no-such-bin" PATH="$only:$core" "$bash_bin" "$VERIFY" --print-chrome
  [ "$status" = 0 ] || fail "status $status"
  has "chosen=$only/chromium"
  has "launch=$only/chromium"

  run env -u CHROME_PATH VERIFY_CHROME_APP="$T/no-such.app" VERIFY_CHROME_USR="$T/no-such-bin" PATH="$empty:$core" "$bash_bin" "$VERIFY" --print-chrome
  [ "$status" = 1 ] || fail "status $status"
  has "Google Chrome is required"

  if [ -d "/Applications/Google Chrome.app" ]; then
    run env -u CHROME_PATH -u VERIFY_CHROME_APP -u VERIFY_CHROME_USR bash "$VERIFY" --print-chrome
    [ "$status" = 0 ] || fail "status $status"
    has "chosen=/Applications/Google Chrome.app"
  elif [ -x /usr/bin/google-chrome ]; then
    run env -u CHROME_PATH -u VERIFY_CHROME_APP -u VERIFY_CHROME_USR bash "$VERIFY" --print-chrome
    [ "$status" = 0 ] || fail "status $status"
    has "chosen=/usr/bin/google-chrome"
    has "launch=channel"
  fi

  local home="$T/home-linux" home_mac="$T/home-mac" home_none="$T/home-none"
  mkdir -p "$home/.cache/ms-playwright/webkit-test" "$home_mac/Library/Caches/ms-playwright/webkit-test" "$home_none"
  run env HOME="$home" CHROME_PATH="$bin/google-chrome" bash "$VERIFY" --doctor
  [ "$status" = 0 ] || fail "linux webkit status $status"
  run env HOME="$home_mac" CHROME_PATH="$bin/google-chrome" bash "$VERIFY" --doctor
  [ "$status" = 0 ] || fail "mac webkit status $status"
  run env HOME="$home_none" CHROME_PATH="$bin/google-chrome" bash "$VERIFY" --doctor
  [ "$status" = 1 ] || fail "missing webkit status $status"
  has "Playwright WebKit is missing"
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

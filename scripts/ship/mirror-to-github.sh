#!/usr/bin/env bash
# Move paper-golf to the private GitHub repo derek-hobden/paper-golf (Derek,
# option 1, 14 Oct 2026). Dry run by default: prints every step, changes nothing.
#
#   bash scripts/ship/mirror-to-github.sh --report <gitleaks.json>            # dry run
#   bash scripts/ship/mirror-to-github.sh --report <gitleaks.json> --yes      # act
#   ... [--force-live-jobs]   # repoint origin even while paper-golf jobs run
#
# Steps: check gh auth; refuse unless the gitleaks report is an empty array;
# refuse while a paper-golf job worktree is live (they share the clone's .git,
# so a repoint changes their origin too); create the repo PRIVATE if missing
# (refuse if it exists and is not private); push main and refs/tags/* from the
# bare repo with explicit refspecs (no --mirror, no --force, no deletes, no new
# commits; bot/* job branches stay local); repoint origin of the bare repo and
# the clone at GitHub (protocol per gh), keeping the old bare path as remote
# local-bare; print the verification commands.
#
# --yes pushes to main, so it must run through the release gate after Derek's
# approval: release-job.sh <job> --step main --run scripts/ship/mirror-to-github.sh
# --report <gitleaks.json> --yes. Never bypass bin/gate.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,21p' "$0"; exit 0 ;; esac
dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$dir/lib.sh"

PG_BARE="${PG_BARE:-/Users/anton/bots-work/repos/.paper-golf.git}"
PG_CLONE="${PG_CLONE:-/Users/anton/bots-work/repos/paper-golf}"
PG_JOBS_DIR="${PG_JOBS_DIR:-/Users/anton/bots-work/jobs}"

yes=0
force_live=0
report=''
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) yes=1 ;;
    --force-live-jobs) force_live=1 ;;
    --report) report="${2:-}"; shift ;;
    *) ship_die "unknown argument: $1" ;;
  esac
  shift
done

if [ "$yes" = 1 ]; then mode=ACT; else mode='DRY RUN'; fi
echo "[hal-infra] mirror-to-github ($mode): $SHIP_REPO"

# Runs a changing command, or only prints it in a dry run.
step() {
  if [ "$yes" = 1 ]; then
    echo "  + $*"
    "$@"
  else
    echo "  would run: $*"
  fi
}

ship_need gh git jq
[ -d "$PG_BARE" ] || ship_die "bare repo not found: $PG_BARE"
[ -d "$PG_CLONE" ] || ship_die "clone not found: $PG_CLONE"

echo "→ gh auth"
gh auth status >/dev/null 2>&1 || ship_die "gh is not authenticated (gh auth login)"
protocol="$(gh config get git_protocol -h github.com 2>/dev/null || true)"
if [ "$protocol" = ssh ]; then
  url="git@github.com:$SHIP_REPO.git"
else
  url="https://github.com/$SHIP_REPO.git"
fi
echo "  ok; protocol ${protocol:-https} -> $url"

echo "→ gitleaks report"
[ -n "$report" ] || ship_die "--report <gitleaks.json> is required (gitleaks git --redact --log-opts=--all ...)"
[ -f "$report" ] || ship_die "gitleaks report not found: $report"
findings="$(jq 'if type == "array" then length else "bad" end' "$report" 2>/dev/null || echo bad)"
[ "$findings" = bad ] && ship_die "gitleaks report is not a JSON array: $report"
[ "$findings" = 0 ] || ship_die "gitleaks report has $findings finding(s); refusing to publish"
echo "  clean (0 findings)"

echo "→ live paper-golf jobs"
live=''
for wt in $(git -C "$PG_CLONE" worktree list --porcelain | sed -n 's/^worktree //p'); do
  case "$wt" in "$PG_JOBS_DIR"/*/worktree) ;; *) continue ;; esac
  job="${wt%/worktree}"
  pid="$(cat "$job/claude.pid" 2>/dev/null || true)"
  if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
    live="$live ${job##*/}"
  fi
done
if [ -n "$live" ]; then
  if [ "$force_live" = 1 ]; then
    echo "  live:$live (continuing: --force-live-jobs)"
  else
    ship_die "paper-golf jobs are live:$live — their worktrees share the clone's .git; wait for them or pass --force-live-jobs"
  fi
else
  echo "  none"
fi

echo "→ GitHub repo"
visibility="$(gh repo view "$SHIP_REPO" --json visibility --jq .visibility 2>/dev/null || true)"
case "$visibility" in
  PRIVATE) echo "  exists, PRIVATE" ;;
  '')
    echo "  missing"
    step gh repo create "$SHIP_REPO" --private --description "Paper Golf (Vite + TypeScript static site)"
    ;;
  *) ship_die "$SHIP_REPO exists and is $visibility, not PRIVATE; refusing" ;;
esac

echo "→ refs to mirror (from $PG_BARE)"
main_sha="$(git -C "$PG_BARE" rev-parse --verify -q refs/heads/main)" || ship_die "bare repo has no main"
echo "  main $main_sha"
tags="$(git -C "$PG_BARE" for-each-ref --format='%(refname:short)' refs/tags)"
tag_count="$(printf '%s' "$tags" | grep -c . || true)"
echo "  tags: $tag_count${tags:+ ($(printf '%s' "$tags" | paste -sd' ' -))}"
echo "  not mirrored: bot/* job branches"
echo "  note: the push to main starts one GitHub Actions CI run (ci.yml)"
step git -C "$PG_BARE" push "$url" refs/heads/main:refs/heads/main 'refs/tags/*:refs/tags/*'

# Repoints origin of one repo at GitHub, keeping the old URL as $2.
repoint() {
  local repo="$1" keep_as="$2" old
  old="$(git -C "$repo" remote get-url origin 2>/dev/null || true)"
  echo "  $repo"
  echo "    before: origin=${old:-<none>}"
  echo "    after:  origin=$url${old:+, $keep_as=$old}"
  if [ "$old" = "$url" ]; then
    echo "    already done"
    return 0
  fi
  if [ -n "$old" ]; then
    if git -C "$repo" remote get-url "$keep_as" >/dev/null 2>&1; then
      echo "    $keep_as exists; kept as is"
    else
      step git -C "$repo" remote add "$keep_as" "$old"
    fi
    step git -C "$repo" remote set-url origin "$url"
  else
    step git -C "$repo" remote add origin "$url"
  fi
}

echo "→ origin"
repoint "$PG_BARE" previous-origin
repoint "$PG_CLONE" local-bare
step git -C "$PG_CLONE" fetch origin

echo "→ verify (Hal, after the --yes run)"
echo "  gh repo view $SHIP_REPO --json visibility                 # PRIVATE"
echo "  git -C $PG_CLONE ls-remote origin main                    # = $main_sha"
echo "  bash scripts/ship/wait-for-next-stage.sh --link           # $SHIP_REPO production-branch=main (VERCEL_TOKEN)"
echo "  npm run test:ship                                         # deploy-watch + mirror tests pass"
if [ "$yes" = 0 ]; then
  echo "dry run: nothing changed. Re-run with --yes through the release gate."
fi

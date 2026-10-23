#!/usr/bin/env bash
# When main moves, bring every open auto-merge pull request that is behind main
# up to date, then dispatch its checks again. A push made with GITHUB_TOKEN does
# not start pull_request workflows (GitHub suppresses them), so check, smoke,
# claude-review are dispatched with refresh_pr set. ci.yml is dispatched on the
# pull request branch. claude-review is dispatched on main, so a pull request
# that edits the workflow still runs main's reviewer. Those runs do not deploy.
#
#   bash scripts/ship/update-pr-branches.sh
#
# The repo settings allow_auto_merge and allow_update_branch are turned on when
# the token can. A 403 leaves them as they are and the run continues. When
# GitHub refuses the update because that setting is off, the pull request ref
# is merged with main and pushed. main itself is never pushed.
#
# Exit 0 when every pull request was updated or skipped, 1 when one failed, 2
# on a usage error. A merge conflict is a skip: a person resolves it.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,17p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: update-pr-branches.sh" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq git

# A branch name this script may push or dispatch. main is refused on purpose.
safe_ref() {
  case "$1" in
    '' | main | HEAD | refs/* | *..* | *' '* | *'//'*) return 1 ;;
  esac
  [[ "$1" =~ ^[A-Za-z0-9._/-]+$ ]]
}

try_settings() {
  local err
  err="$(mktemp)"
  if gh api --method PATCH "/repos/$SHIP_REPO" \
    -f allow_auto_merge=true -f allow_update_branch=true -f delete_branch_on_merge=true >/dev/null 2>"$err"; then
    echo "settings=updated"
  else
    echo "settings=unchanged"
  fi
  rm -f "$err"
}

# number, draft|ready, sha, ref, repo, yes|no. One line per open pull request.
list_prs() {
  gh api --paginate "/repos/$SHIP_REPO/pulls?state=open&base=main&per_page=100" --jq '
    .[] | [
      (.number | tostring),
      (if .draft then "draft" else "ready" end),
      .head.sha,
      .head.ref,
      (.head.repo.full_name // ""),
      (if .auto_merge == null then "no" else "yes" end)
    ] | @tsv'
}

# skip, fallback or fail, from gh's stderr on a refused update.
classify() {
  case "$1" in
    *'HTTP 422'*)
      case "$1" in
        *[Cc]onflict*) echo skip ;;
        *'no new commits'* | *'up to date'* | *'up-to-date'*) echo skip ;;
        *'not allowed'* | *'not enabled'* | *[Dd]isabled*) echo fallback ;;
        *) echo fail ;;
      esac
      ;;
    *) echo fail ;;
  esac
}

poll_head() {
  local number="$1" old="$2" tries="${UPDATE_POLL_TRIES:-30}" pause="${UPDATE_POLL_S:-2}" i=0 sha
  while [ "$i" -lt "$tries" ]; do
    sha="$(gh api "/repos/$SHIP_REPO/pulls/$number" --jq '.head.sha')" || return 1
    if [ -n "$sha" ] && [ "$sha" != "$old" ]; then
      printf '%s\n' "$sha"
      return 0
    fi
    i=$((i + 1))
    sleep "$pause"
  done
  return 1
}

dispatch_refresh() {
  local ref="$1" number="$2"
  gh api --method POST "/repos/$SHIP_REPO/actions/workflows/ci.yml/dispatches" \
    -f "ref=$ref" -f "inputs[refresh_pr]=$number" || return 1
  # main's workflow file, not the pull request's. The run records its check on
  # the pull request head (claude-review.yml, workflow_dispatch).
  gh api --method POST "/repos/$SHIP_REPO/actions/workflows/claude-review.yml/dispatches" \
    -f "ref=main" -f "inputs[refresh_pr]=$number" || return 1
}

# Merge main into the pull request ref and push that ref only. 3 means conflict.
git_fallback() {
  local ref="$1" root wt dest
  # Called from a conditional, so set -e does not apply here. Every step checks itself.
  safe_ref "$ref" || { echo "refused ref $ref"; return 1; }
  dest="refs/heads/${ref}"
  [ "$dest" != refs/heads/main ] || { echo "refused ref main"; return 1; }
  git fetch origin "$ref" main || return 1
  git rev-parse --verify "refs/remotes/origin/${ref}" >/dev/null 2>&1 || {
    echo "no origin/$ref"
    return 1
  }
  root="$(git rev-parse --show-toplevel)" || return 1
  # worktree add creates the path. mktemp only reserves a parent inside the repo.
  parent="$(mktemp -d "$root/.pg-update.XXXXXX")" || return 1
  wt="$parent/wt"
  if ! git worktree add --detach "$wt" "refs/remotes/origin/${ref}"; then
    rm -rf "$parent"
    return 1
  fi
  if ! git -C "$wt" merge --no-edit origin/main; then
    git worktree remove --force "$wt" || rm -rf "$parent"
    rm -rf "$parent"
    return 3
  fi
  if ! git -C "$wt" push origin "HEAD:${dest}"; then
    git worktree remove --force "$wt" || rm -rf "$parent"
    rm -rf "$parent"
    return 1
  fi
  git worktree remove --force "$wt" || rm -rf "$parent"
  rm -rf "$parent"
}

# 0 updated or skipped, 1 failed.
process_one() {
  local number="$1" draft="$2" sha="$3" ref="$4" repo="$5" auto="$6"
  local behind err kind fb
  if [ "$draft" = draft ]; then echo "skip #$number draft"; return 0; fi
  if [ "$repo" != "$SHIP_REPO" ]; then echo "skip #$number fork"; return 0; fi
  if [ "$auto" != yes ]; then echo "skip #$number no-auto-merge"; return 0; fi
  safe_ref "$ref" || { echo "fail #$number refused ref"; return 1; }
  behind="$(gh api "/repos/$SHIP_REPO/compare/main...$sha" --jq '.behind_by')" || {
    echo "fail #$number compare"
    return 1
  }
  if [ "$behind" = 0 ]; then echo "skip #$number up-to-date"; return 0; fi
  err="$(mktemp)"
  if gh api --method PUT "/repos/$SHIP_REPO/pulls/$number/update-branch" \
    -f "expected_head_sha=$sha" >/dev/null 2>"$err"; then
    rm -f "$err"
    poll_head "$number" "$sha" >/dev/null || { echo "fail #$number poll"; return 1; }
    dispatch_refresh "$ref" "$number" || { echo "fail #$number dispatch"; return 1; }
    echo "updated #$number"
    return 0
  fi
  kind="$(classify "$(cat "$err")")"
  rm -f "$err"
  case "$kind" in
    skip) echo "skip #$number api"; return 0 ;;
    fallback) ;;
    *) echo "fail #$number api"; return 1 ;;
  esac
  fb=0
  git_fallback "$ref" || fb=$?
  if [ "$fb" = 3 ]; then echo "skip #$number conflict"; return 0; fi
  if [ "$fb" != 0 ]; then echo "fail #$number git"; return 1; fi
  dispatch_refresh "$ref" "$number" || { echo "fail #$number dispatch"; return 1; }
  echo "updated #$number by merge"
}

try_settings
prs="$(list_prs)" || { echo "cannot list pull requests" >&2; exit 1; }
failures=0
while IFS=$'\t' read -r number draft sha ref repo auto; do
  [ -n "$number" ] || continue
  process_one "$number" "$draft" "$sha" "$ref" "$repo" "$auto" || failures=$((failures + 1))
done <<<"$prs"
[ "$failures" = 0 ]

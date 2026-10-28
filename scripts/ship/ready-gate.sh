#!/usr/bin/env bash
# The merge gate for the paid work. The Claude review costs money, so it runs
# on a ready mark and on the pushes that need one (scripts/ship/paid-trigger.sh)
# and not on every push. This gate spends nothing — it reads the pull request
# and answers one question:
#
#   did the latest Claude review since the last ready mark pass, and does it
#   cover the head?
#
# It covers the head when it read the head, or when every commit since is docs
# only or a clean merge of main (scripts/ship/review-state.sh, which this asks).
# Otherwise it says which: waiting for the review, or "Review asked for
# changes" with the round, or, after three rounds, that a person has to look.
#
#   GH_TOKEN=... PR=<number> bash scripts/ship/ready-gate.sh check
#   GH_TOKEN=... PR=<number> bash scripts/ship/ready-gate.sh report
#
# check  prints the verdict and exits 1 when the gate is not satisfied: that is
#        the required status check, run on every pull request event. When it
#        is red only because a Claude review run for the head is queued or in
#        progress — the ready mark starts both at once — it waits for it
#        instead (lib.sh ship_wait_next: 15 s, doubling to 60 s, 10 minutes
#        at most), re-reading the pull request each time: green as soon as the
#        review has passed, red at once if it finishes red, and red after 10
#        minutes saying the review is still running. A red for any other
#        reason fails at once.
# report does the same without waiting, then records the verdict as a
#        `ready-gate` check run on the pull request's head commit, and exits 0
#        whatever the verdict. It is the fallback the review dispatches when
#        there is no gate run of this head to re-run (rerun-failed.sh); the
#        review re-runs the original failed run when there is one, so the red
#        it left does not stay in the head's rollup.
#
# A draft is red on purpose ("mark it ready when it is finished"). A fork and
# the dependency bots are green: they do not get the paid jobs at all, so there
# is no review to wait for. Reads through gh; the only write is that check run.
# Exit 0 satisfied, 1 not satisfied (check only), 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,37p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

mode="${1:-}"
case "$mode" in check | report) ;; *) echo "usage: ready-gate.sh check|report (see --help)" >&2; exit 2 ;; esac
[ $# -eq 1 ] || { echo "usage: ready-gate.sh check|report (see --help)" >&2; exit 2; }
ship_need gh jq
[ -n "${PR:-}" ] || { echo "PR is not set" >&2; exit 2; }
case "$PR" in '' | *[!0-9]*) echo "PR must be a pull request number" >&2; exit 2 ;; esac

# The check this gate records.
GATE_CHECK=ready-gate
READY_LABEL="$SHIP_READY_LABEL"
# Rounds that asked for changes before a person has to look (lib.sh, shared
# with paid-trigger.sh).
MAX_ROUNDS="$SHIP_MAX_ROUNDS"

verdict=''   # success | failure
summary=''
waitable=0   # 1 when the red is one a review still in flight could turn green

# The pull request, as four tab-separated fields. Read again on every poll.
read_pr() {
  local pr_row
  pr_row="$(gh api "/repos/$SHIP_REPO/pulls/$PR" \
    --jq '[(.draft|tostring), .head.sha, (.head.repo.full_name // ""), .user.login] | @tsv')" || return 1
  IFS=$'\t' read -r pr_draft pr_head pr_head_repo pr_author <<<"$pr_row"
}
read_pr || {
  echo "cannot read pull request $PR" >&2
  exit 2
}

decide() {
  waitable=0
  if [ -n "$pr_head_repo" ] && [ "$pr_head_repo" != "$SHIP_REPO" ]; then
    verdict=success
    summary="The head is the fork $pr_head_repo, which does not get the paid jobs. Nothing to wait for."
    return 0
  fi
  case "$pr_author" in
    'dependabot[bot]' | 'renovate[bot]')
      verdict=success
      summary="$pr_author does not get the paid jobs. Nothing to wait for."
      return 0
      ;;
  esac
  if [ "$pr_draft" = true ]; then
    verdict=failure
    summary="This pull request is a draft. Work on it as long as you like — the free checks run on every push. Mark it ready for review when it is finished and the Claude review and the explainer video run once."
    return 0
  fi

  local answer state round why
  answer="$(GITHUB_OUTPUT='' bash "$here/review-state.sh")" || {
    verdict=failure
    summary="Could not read where the Claude review stands on this pull request. Re-run this job."
    return 0
  }
  state="$(sed -n 's/^state=//p' <<<"$answer")"
  round="$(sed -n 's/^round=//p' <<<"$answer")"
  why="$(sed -n 's/^reason=//p' <<<"$answer")"
  verdict=failure
  # At the cap no review starts on its own, so there is nothing to wait for.
  local person="Review asked for changes (round $round), and that is $MAX_ROUNDS rounds since the last ready mark, so this needs a person: no review starts on its own from here. Adding the $READY_LABEL label starts the rounds over with a fresh review."
  case "$state" in
    passed)
      verdict=success
      summary="The review passed: $why. Docs-only commits and clean merges of main since then do not need one of their own."
      ;;
    changes-requested)
      # A code push after it starts the next round; while that review runs, wait.
      if [ "${round:-0}" -ge "$MAX_ROUNDS" ]; then
        summary="$person"
      else
        waitable=1
        summary="Review asked for changes (round $round). Its Problems found comment on this pull request lists them; push a fix in code and the review runs again (a docs-only commit or a merge of main does not start one)."
      fi
      ;;
    stale-pass)
      if [ "${round:-0}" -ge "$MAX_ROUNDS" ]; then
        summary="$person"
      else
        waitable=1
        summary="Waiting for the Claude review: $why. The push starts a fresh review."
      fi
      ;;
    broke)
      waitable=1
      summary="Waiting for the Claude review: its last run broke, which is not a round (the Claude review status comment says why). Re-run it from the Actions tab, or add the $READY_LABEL label."
      ;;
    *)
      waitable=1
      summary="Waiting for the Claude review: ${why:-none has finished}. It runs when the pull request is marked ready for review; add the $READY_LABEL label to ask for it again."
      ;;
  esac
}

decide

# check only: wait while a review run for the head is in flight, rather than
# leave a red in the rollup that the review is about to answer.
if [ "$mode" = check ] && [ "$verdict" = failure ] && [ "$waitable" = 1 ]; then
  waited=0
  delay=0
  while [ "$(ship_runs_in_flight claude-review.yml "$pr_head" 2>/dev/null || echo 0)" != 0 ]; do
    delay="$(ship_wait_next "$delay" "$waited")"
    if [ "$delay" -le 0 ]; then
      summary="The Claude review is still running after $((waited / 60)) minutes. This check will be re-run when it finishes."
      break
    fi
    echo "ready-gate: a Claude review run for $pr_head is in progress; looking again in ${delay}s"
    ship_wait_sleep "$delay"
    waited=$((waited + delay))
    if ! read_pr; then
      summary="Could not read pull request $PR again while waiting for the review. Re-run this job."
      waitable=0
      break
    fi
    decide
    if [ "$verdict" != failure ] || [ "$waitable" != 1 ]; then break; fi
  done
fi

printf 'ready-gate: %s\n%s\n' "$verdict" "$summary"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### Ready gate\n\n%s\n' "$summary" >>"$GITHUB_STEP_SUMMARY"
fi

if [ "$mode" = check ]; then
  [ "$verdict" = success ] || { echo "::error::$summary" >&2; exit 1; }
  exit 0
fi

# report: the verdict belongs on the pull request's head commit, because this
# run is a dispatch on main and its own job status lands there instead.
body="$(mktemp)"
trap 'rm -f "$body"' EXIT
now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
url="${GITHUB_SERVER_URL:-https://github.com}/$SHIP_REPO/actions/runs/${GITHUB_RUN_ID:-0}"
jq -n --arg name "$GATE_CHECK" --arg sha "$pr_head" --arg conclusion "$verdict" \
  --arg now "$now" --arg url "$url" --arg summary "$summary" \
  '{name:$name, head_sha:$sha, status:"completed", conclusion:$conclusion,
    started_at:$now, completed_at:$now, details_url:$url,
    output:{title:"Ready gate", summary:$summary}}' >"$body"
if gh api --method POST "/repos/$SHIP_REPO/check-runs" --input "$body" >/dev/null; then
  echo "ready-gate: recorded $verdict on $pr_head"
else
  echo "ready-gate: could not record the check run on $pr_head" >&2
fi
exit 0

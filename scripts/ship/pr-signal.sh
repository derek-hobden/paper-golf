#!/usr/bin/env bash
# One ready signal, and one blocked signal, for whoever is watching.
#
# A bot that owns a pull request used to wake on every comment and every review,
# which is nearly all noise. These are the only two things worth waking for, and
# each is one comment with a hidden marker at the very start of its body:
#
#   <!-- pr-ready -->    the pull request is ready to merge: every required check
#                        is green. It says whether CI's explainer video is the
#                        first line of the body, and waits for it only while a
#                        video for the head is still being made: the video is
#                        best effort and never holds a merge (Derek, 1 Nov
#                        2026). At most once per head commit.
#   <!-- pr-blocked -->  the PR blockers comment: every blocker on the head
#                        commit, one line each — what, the exact reason, the
#                        run link and the next step — or "No blockers on
#                        <sha7>" once they are gone (scripts/ship/pr-blockers.sh).
#
#   GH_TOKEN=<app token> PR=<number> bash scripts/ship/pr-signal.sh ready
#   GH_TOKEN=<app token> PR=<number> bash scripts/ship/pr-signal.sh blockers
#   GH_TOKEN=<app token> PR=<number> SIGNAL_WHAT='Claude review' \
#     SIGNAL_RUN_URL=<url> bash scripts/ship/pr-signal.sh blocked
#
# blockers refreshes the PR blockers comment from what is on the head now;
# blocked does the same and also lists SIGNAL_WHAT, the run that just failed.
#
# SIGNAL_PRINT=1 with blockers prints the comment it would write and writes
# nothing, for any pull request, open or not; SIGNAL_HEAD=<full sha> then judges
# that commit's runs instead of the head's. The explainer's evidence shows the
# comment this way (pr-video-evidence.sh `blockers`).
#
# With PR empty, SIGNAL_RUN_TITLE finds it when it is a publish run's name
# ("PR video publish for pull request <n> at <sha>", ship_video_publish_name: a
# publish run's own head is main's), else HEAD_SHA does: a workflow_run event
# does not always carry the pull request its run belongs to.
#
# Review first, then the video. SIGNAL_REVIEW is where the review stands
# (scripts/ship/review-state.sh; without it, the claude-review check run on the
# head says): a `changes-requested` review is a blockers line with its round
# (SIGNAL_ROUND) and a link to the Problems found comment, and `broke` says the
# review broke. A cancelled review (SIGNAL_CONCLUSION=cancelled) was replaced by
# a newer one and says nothing. The video's runs are never blockers.
#
# The comment is found by its marker and edited in place, so a pull request
# never collects a column of them. Prints:
#   signal=posted     the comment was written for the first time
#   signal=updated    the comment was edited (a new head, or new words)
#   signal=unchanged  it already says this, so nothing was written
#   signal=waiting    not ready yet, and `reason` says what for. Nothing written
#   signal=skip       a draft, a fork, or closed: this signal does not apply
#
# The required checks are SIGNAL_CHECKS (`check smoke pr-video ready-gate`), each
# judged on its newest run against the head commit. A pull request that gets no
# explainer video — Dependabot, Renovate — is ready without one, and so is one
# whose video failed or was never made. Whether a video for the head is still
# being made is read from its runs on RUNS_TOKEN (the job's own token, actions:
# read; the app has no Actions permission), else GH_TOKEN.
#
# Reads the pull request through gh api. Nothing from its head is checked out or
# run, and nothing here spends money. Exit 0 on every decision, 1 when the pull
# request cannot be read, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,54p' "$0"; exit 0 ;; esac
mode="${1:-}"
case "$mode" in ready | blocked | blockers) ;; *) echo "usage: pr-signal.sh ready|blocked|blockers (see --help)" >&2; exit 2 ;; esac
[ $# -eq 1 ] || { echo "usage: pr-signal.sh ready|blocked|blockers (see --help)" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

READY_MARKER='<!-- pr-ready -->'
BLOCKED_MARKER='<!-- pr-blocked -->'
# The checks a pull request of this repository has to pass to be mergeable.
# Another repository sets its own (docs/pipeline-rollout.md).
SIGNAL_CHECKS="${SIGNAL_CHECKS:-check smoke pr-video ready-gate}"
# Where a CI-made explainer video lives: an asset on one of the PR video
# shelves (AGENTS.md "PR explainer videos"). The strict form is the pr-video
# check's to enforce (ship_video_link_re in lib.sh); this only asks whether CI has
# written its link to the top yet, and every shelf's link carries this stem.
VIDEO_HOST="releases/download/$SHIP_VIDEO_SHELF_PREFIX"

decided() {
  echo "signal=$1"
  echo "reason=$2"
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    printf '### PR signal\n\n%s\n' "$2" >>"$GITHUB_STEP_SUMMARY"
  fi
  exit 0
}

pr="${PR:-}"
# A publish run's name says which pull request it films (pr-video-publish.yml's
# run-name), and its own head sha is main's, which would find the wrong one.
if [ -z "$pr" ] && [[ "${SIGNAL_RUN_TITLE:-}" =~ ^PR\ video\ publish\ for\ pull\ request\ ([0-9]+)\ at\ [0-9a-f]{40}$ ]]; then
  pr="${BASH_REMATCH[1]}"
fi
if [ -z "$pr" ]; then
  head_sha="${HEAD_SHA:-}"
  [ -n "$head_sha" ] || { echo "PR or HEAD_SHA is required" >&2; exit 2; }
  [[ "$head_sha" =~ ^[0-9a-f]{7,40}$ ]] || { echo "HEAD_SHA is not a commit sha" >&2; exit 2; }
  pr="$(gh api "/repos/$SHIP_REPO/commits/$head_sha/pulls" --jq '.[0].number // empty')" || {
    echo "cannot read the pull requests of $head_sha" >&2
    exit 1
  }
  [ -n "$pr" ] || decided skip "no pull request for ${head_sha:0:12}"
fi
case "$pr" in '' | *[!0-9]*) echo "PR must be a pull request number" >&2; exit 2 ;; esac

printing=''
if [ "${SIGNAL_PRINT:-}" = 1 ]; then
  [ "$mode" = blockers ] || { echo "SIGNAL_PRINT is for pr-signal.sh blockers" >&2; exit 2; }
  printing=1
fi
if [ -n "${SIGNAL_HEAD:-}" ]; then
  [ -n "$printing" ] || { echo "SIGNAL_HEAD needs SIGNAL_PRINT=1: a comment is only ever written for the head" >&2; exit 2; }
  [[ "$SIGNAL_HEAD" =~ ^[0-9a-f]{40}$ ]] || { echo "SIGNAL_HEAD is not a full commit sha" >&2; exit 2; }
fi

if [ "$mode" = blocked ]; then
  [ -n "${SIGNAL_WHAT:-}" ] || { echo "SIGNAL_WHAT is not set: pr-signal.sh blocked needs to know what failed" >&2; exit 2; }
fi

# One object: a flattened line would cut the body at its first newline.
info="$(gh api "/repos/$SHIP_REPO/pulls/$pr" --jq '.')" || {
  echo "cannot read pull request $pr" >&2
  exit 1
}
pr_state="$(jq -r '.state // ""' <<<"$info")"
pr_draft="$(jq -r 'if .draft == true then "true" else "false" end' <<<"$info")"
pr_head="$(jq -r '.head.sha // ""' <<<"$info")"
pr_head_repo="$(jq -r '.head.repo.full_name // ""' <<<"$info")"
pr_author="$(jq -r '.user.login // ""' <<<"$info")"
pr_body="$(jq -r '.body // ""' <<<"$info")"

# Printing writes nothing, so it reads any pull request and any of its commits.
if [ -n "$printing" ]; then
  pr_head="${SIGNAL_HEAD:-$pr_head}"
  pr_state=open pr_draft=false pr_head_repo=''
fi
[ "$pr_state" = open ] || decided skip "pull request $pr is $pr_state, not open"
[ "$pr_draft" != true ] || decided skip "pull request $pr is a draft: nothing is ready until it is marked ready for review"
[ -z "$pr_head_repo" ] || [ "$pr_head_repo" = "$SHIP_REPO" ] ||
  decided skip "the head of pull request $pr is the fork $pr_head_repo, which this pipeline does not merge"

# The ids of the comments carrying a marker. A page with no match prints
# nothing, so paging cannot pass an empty line off as "there is none".
#
# The author has to be an app, not only the marker: anyone who can comment can
# write `<!-- pr-ready -->` and a head sha, and this would then find that
# comment, answer `unchanged` and never post the real signal. `user.type` comes
# from GitHub, not from the body, so a person cannot claim it. A watcher should
# match on the app's login as well as the marker for the same reason.
marker_comment_ids() {
  gh api --paginate "/repos/$SHIP_REPO/issues/$pr/comments?per_page=100" --jq '
    .[] | select(.user.type == "Bot")
    | select(((.body // "") | startswith("'"$1"'"))) | .id' || return 1
}

# A comment is listed and created under the pull request, but read and edited on
# its own path: the nested one is not a route (scripts/ship/review-status.sh).
comment_body() {
  gh api "/repos/$SHIP_REPO/issues/comments/$1" --jq '.body // ""' || return 1
}

# say <marker> <text> <reason> [enough]: the one comment with that marker says
# this now — edited where it exists, written once where it does not. With
# `enough` given, a comment whose body already contains it is left exactly as it
# is: that is how the ready signal fires at most once per head commit, whatever
# words it used last time. Without it, the same text is what counts as said.
say() {
  local marker="$1" text="$2" reason="$3" enough="${4:-}" ids line id='' current='' body_file
  ids="$(marker_comment_ids "$marker")" || {
    echo "cannot read the comments on pull request $pr" >&2
    exit 1
  }
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      id="$line"
      break
    fi
  done <<<"$ids"
  if [ -n "$id" ]; then
    current="$(comment_body "$id")" || {
      echo "cannot read the $marker comment on pull request $pr" >&2
      exit 1
    }
    if [ -n "$enough" ]; then
      case "$current" in
        *"$enough"*) decided unchanged "the $marker comment on pull request $pr already covers this" ;;
      esac
    elif [ "$current" = "$text" ]; then
      decided unchanged "the $marker comment on pull request $pr already says this"
    fi
  fi
  body_file="$(mktemp)"
  BODY="$text" jq -n '{body: env.BODY}' >"$body_file"
  if [ -n "$id" ]; then
    gh api --method PATCH "/repos/$SHIP_REPO/issues/comments/$id" --input "$body_file" >/dev/null || {
      rm -f "$body_file"
      echo "::warning::could not edit the $marker comment on pull request $pr"
      exit 1
    }
    rm -f "$body_file"
    decided updated "$reason"
  fi
  gh api --method POST "/repos/$SHIP_REPO/issues/$pr/comments" --input "$body_file" >/dev/null || {
    rm -f "$body_file"
    echo "::warning::could not comment on pull request $pr"
    exit 1
  }
  rm -f "$body_file"
  decided posted "$reason"
}

# The first line of its input that is not blank. awk reads to the end, so the
# writer is never cut off: `| head -n 1` under pipefail killed the writer with
# SIGPIPE on a long body and failed the whole run ("Broken pipe"), so the ready
# signal for pull request 72 never went out (28 Oct 2026).
first_line() { awk 'NF && !done { print; done = 1 }'; }

if [ "$mode" != ready ]; then
  # shellcheck source=scripts/ship/pr-blockers.sh
  . "$here/pr-blockers.sh"
fi

# ready from here down: every required check, judged on its newest run.
checks="$(gh api --paginate "/repos/$SHIP_REPO/commits/$pr_head/check-runs?per_page=100" --jq '
  [.check_runs[]?] | group_by(.name) | map(sort_by(.started_at, .id) | last)
  | .[] | [.name, .status, (.conclusion // "")] | @tsv')" || {
  echo "cannot read the check runs on $pr_head" >&2
  exit 1
}

for want in $SIGNAL_CHECKS; do
  found=''
  status=''
  conclusion=''
  # Not a pipe, so these stay set after the loop.
  while IFS=$'\t' read -r name status conclusion; do
    if [ "$name" = "$want" ]; then
      found=1
      break
    fi
  done <<<"$checks"
  [ -n "$found" ] || decided waiting "the $want check has not reported on ${pr_head:0:12} yet"
  [ "$status" = completed ] ||
    decided waiting "the $want check is still running on ${pr_head:0:12}"
  [ "$conclusion" = success ] ||
    decided waiting "the $want check is $conclusion on ${pr_head:0:12}"
done

# video_in_flight: is a video for this head still being made? A PR video record
# run for the head, or a publish run named for it, queued or in progress. A
# lookup that cannot be read counts as in flight: ready is said once per head,
# so it waits rather than say it too early, and the next run decides. (A
# recording that has just finished starts its publish a moment later; the
# publish's own run, when it ends, is the next run.)
video_in_flight() {
  local n name
  name="$(ship_video_publish_name "$pr" "$pr_head")"
  n="$(GH_TOKEN="${RUNS_TOKEN:-$GH_TOKEN}" ship_runs_in_flight pr-video-record.yml "$pr_head" 2>/dev/null)" || return 0
  [ "$n" = 0 ] || return 0
  n="$(GH_TOKEN="${RUNS_TOKEN:-$GH_TOKEN}" ship_runs_in_flight pr-video-publish.yml "$pr_head" "$name" 2>/dev/null)" || return 0
  [ "$n" = 0 ] || return 0
  return 1
}

# The video, which is best effort and never holds a merge: said when it is the
# first line of the body, waited for only while one for this head is being made.
video_note='and the explainer video is the first line of the body'
case "$pr_author" in
  'dependabot[bot]' | 'renovate[bot]')
    video_note="and this pull request gets no explainer video ($pr_author does not earn the paid jobs)"
    ;;
  *)
    first="$(first_line <<<"$pr_body")"
    case "$first" in
      *"$VIDEO_HOST"*) ;;
      *)
        if video_in_flight; then
          decided waiting "the explainer video for ${pr_head:0:12} is still being made; ready is said once it is published, or once it is not"
        fi
        video_note='and no explainer video is on the first line of the body (the video is best effort and never holds a merge)'
        ;;
    esac
    ;;
esac

say "$READY_MARKER" \
  "$READY_MARKER
Pull request $pr is ready to merge: $(printf '%s' "$SIGNAL_CHECKS" | tr ' ' ',' | sed 's/,/, /g') are green, $video_note (head $pr_head)." \
  "pull request $pr is ready to merge at $pr_head" \
  "$pr_head"

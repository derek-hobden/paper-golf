#!/usr/bin/env bash
# The PR blockers comment: the one place a pull request says what is wrong with
# it and what to do next, whoever opened it and with whatever tool. Sourced by
# scripts/ship/pr-signal.sh for `blockers` and `blocked`, after it has read the
# pull request (pr, pr_head) and skipped a draft, a fork and a closed one.
#
# The comment is the app's `<!-- pr-blocked -->` comment (the marker the owner
# bots watch), edited in place and never deleted. It lists every blocker on the
# head commit, one line each — what is blocked, the exact reason, the run link
# and the next step:
#
#   - each required check (SIGNAL_CHECKS) whose newest run on the head is
#     failure, cancelled or timed_out. The reason is the check run's first error
#     annotation — the `Why it failed` line scripts/ship/check-summary.sh writes,
#     whose `Next:` is the next step — else its first other error, else its
#     output title, else "see the run". A pending check is not a blocker.
#   - the paid jobs and the video publish: the claude-review check run on the
#     head (linked to the review's own detail comment, <!-- claude-review-status
#     -->), the newest PR video record run for the head and the newest PR video
#     publish run for it (found by the name pr-video-publish.yml gives it).
#   - `blocked` only: SIGNAL_WHAT, the run that just failed, when the lookups
#     above did not already list it.
#
# With nothing left, an existing comment becomes "No blockers on <sha7>"; a pull
# request that never had a blocker gets no comment at all.
#
# Workflow runs are read with RUNS_TOKEN when it is set (the job's own token,
# actions: read — the app has no Actions permission), else GH_TOKEN. A lookup
# that cannot be read is a warning, not a stop: the comment says what it can.

: "${pr:?}" "${pr_head:?}" "${mode:?}" "${here:?}"

blockers_runs_api() {
  GH_TOKEN="${RUNS_TOKEN:-$GH_TOKEN}" gh api "$@"
}

# What the next step is when the check did not say: check-summary.sh's own
# table, so the check page and this comment name the same one.
blockers_next_for() {
  bash "$here/check-summary.sh" --next "$1"
}

blockers_verb() {
  case "$1" in
    cancelled) echo 'was cancelled' ;;
    timed_out) echo 'timed out' ;;
    *) echo 'failed' ;;
  esac
}

blocker_lines=''
blocker_names=' '
# blocker <what> <conclusion> <reason> <url> <next>
blocker() {
  local reason="$3" url="$4" link=''
  reason="$(printf '%s' "$reason" | tr '\r\n' '  ' | tr -s ' ' | sed 's/^ //; s/ $//; s/[.]$//')"
  [ -n "$reason" ] || reason='see the run'
  [ -z "$url" ] || link=" ([the run]($url))"
  blocker_lines="${blocker_lines}- **$1** $(blockers_verb "$2"): $reason.$link Next: $5"$'\n'
  blocker_names="$blocker_names$1 "
}

# The comments first: the blockers comment to edit, and the review's own detail
# comment to link a failed review to. Both are the app's, by user.type.
blockers_comments="$(gh api --paginate "/repos/$SHIP_REPO/issues/$pr/comments?per_page=100" --jq '
  .[] | select(.user.type == "Bot")
  | if ((.body // "") | startswith("'"$BLOCKED_MARKER"'")) then "blocked\t\(.id)"
    elif ((.body // "") | contains("<!-- claude-review-status -->")) then "review\t\(.html_url // "")"
    else empty end')" || {
  echo "cannot read the comments on pull request $pr" >&2
  exit 1
}
blockers_id=''
review_comment_url=''
while IFS=$'\t' read -r kind value; do
  case "$kind" in
    blocked) [ -n "$blockers_id" ] || blockers_id="$value" ;;
    review) review_comment_url="$value" ;;
  esac
done <<<"$blockers_comments"
blockers_current=''
if [ -n "$blockers_id" ]; then
  blockers_current="$(comment_body "$blockers_id")" || {
    echo "cannot read the $BLOCKED_MARKER comment on pull request $pr" >&2
    exit 1
  }
fi

# The newest run of each check on the head, one JSON object a line.
blockers_checks="$(gh api --paginate "/repos/$SHIP_REPO/commits/$pr_head/check-runs?per_page=100" --jq '
  [.check_runs[]?] | group_by(.name) | map(sort_by(.started_at, .id) | last)
  | .[] | {name, status, conclusion: (.conclusion // ""), id, url: (.html_url // .details_url // ""),
           title: (.output.title // "")} | @json')" || {
  echo "cannot read the check runs on $pr_head" >&2
  exit 1
}

# The first error annotation: check-summary.sh's `Why it failed` line when there
# is one, else the first error that is not the runner's own exit-code line.
annotation_jq='[.[]? | select(.annotation_level == "failure")]
  | ([.[] | select(.title == "Why it failed")]
     + [.[] | select((.message // "") | test("^Process completed with exit code") | not)])
  | (.[0].message // "") | split("\n") | .[0] // ""'
# check_reason <id> <title>: "reason<TAB>next" from the check run's annotations.
check_reason() {
  local found
  # The title, not the text, marks check-summary.sh's own line.
  found="$(gh api "/repos/$SHIP_REPO/check-runs/$1/annotations?per_page=50" --jq "$annotation_jq" 2>/dev/null)" || found=''
  [ -n "$found" ] || found="$2"
  case "$found" in
    *' Next: '*) printf '%s\t%s\n' "${found%% Next: *}" "${found#* Next: }" ;;
    *) printf '%s\t\n' "$found" ;;
  esac
}

red() { case "$1" in failure | cancelled | timed_out) return 0 ;; *) return 1 ;; esac; }

for want in $SIGNAL_CHECKS claude-review; do
  row="$(jq -c --arg n "$want" 'select(.name == $n)' <<<"$blockers_checks" | head -n 1)"
  [ -n "$row" ] || continue
  [ "$(jq -r '.status' <<<"$row")" = completed ] || continue
  conclusion="$(jq -r '.conclusion' <<<"$row")"
  red "$conclusion" || continue
  url="$(jq -r '.url' <<<"$row")"
  if [ "$want" = claude-review ]; then
    [ -z "$review_comment_url" ] || url="$review_comment_url"
    blocker 'Claude review' "$conclusion" "$(jq -r '.title' <<<"$row")" "$url" "$(blockers_next_for 'Claude review')"
    continue
  fi
  IFS=$'\t' read -r reason next <<<"$(check_reason "$(jq -r '.id' <<<"$row")" "$(jq -r '.title' <<<"$row")")"
  [ -n "${next:-}" ] || next="$(blockers_next_for "$want")"
  blocker "$want" "$conclusion" "${reason:-}" "$url" "$next"
done

# The video's own runs for this head, newest first: a red one is a blocker until
# a newer run for the same head comes back clean.
newest_run() {
  blockers_runs_api "$1" --jq "$2"' | sort_by(.created_at // "", .id) | last
    | select(. != null) | [.status, (.conclusion // ""), (.html_url // "")] | @tsv' 2>/dev/null
}
if row="$(newest_run "/repos/$SHIP_REPO/actions/workflows/pr-video-record.yml/runs?head_sha=$pr_head&per_page=30" \
  '[.workflow_runs[]? | select(.head_sha == "'"$pr_head"'")]')"; then
  IFS=$'\t' read -r st con url <<<"$row"
  if [ "${st:-}" = completed ] && red "${con:-}"; then
    blocker 'PR video record' "$con" 'the explainer recording did not finish' "$url" "$(blockers_next_for 'PR video record')"
  fi
else
  echo "::warning::could not read the PR video record runs for $pr_head"
fi
publish_name="$(ship_video_publish_name "$pr" "$pr_head")"
if row="$(newest_run "/repos/$SHIP_REPO/actions/workflows/pr-video-publish.yml/runs?per_page=30" \
  '[.workflow_runs[]? | select(.display_title == "'"$publish_name"'")]')"; then
  IFS=$'\t' read -r st con url <<<"$row"
  if [ "${st:-}" = completed ] && red "${con:-}"; then
    blocker 'PR video publish' "$con" 'the explainer video was not published' "$url" "$(blockers_next_for 'PR video publish')"
  fi
else
  echo "::warning::could not read the PR video publish runs for $pr_head"
fi

# The run that just failed, when the lookups above did not list it already.
if [ "$mode" = blocked ]; then
  case "$blocker_names" in
    *" $SIGNAL_WHAT "*) ;;
    *) blocker "$SIGNAL_WHAT" failure "the $SIGNAL_WHAT run did not come back clean" \
      "${SIGNAL_RUN_URL:-}" "$(blockers_next_for "$SIGNAL_WHAT")" ;;
  esac
fi

short="${pr_head:0:7}"
if [ -n "$blocker_lines" ]; then
  count="$(printf '%s' "$blocker_lines" | grep -c '^- ')"
  plural=blockers
  [ "$count" != 1 ] || plural=blocker
  text="$BLOCKED_MARKER
### PR blockers

Pull request $pr has $count $plural on $short (head $pr_head):

${blocker_lines%$'\n'}"
  why="pull request $pr has $count $plural on $short"
else
  [ -n "$blockers_id" ] || decided none "pull request $pr has no blockers on $short, and no blockers comment to clear"
  text="$BLOCKED_MARKER
### PR blockers

No blockers on $short (head $pr_head)."
  why="pull request $pr has no blockers on $short"
fi

[ "$blockers_current" != "$text" ] || decided unchanged "the $BLOCKED_MARKER comment on pull request $pr already says this"
body_file="$(mktemp)"
BODY="$text" jq -n '{body: env.BODY}' >"$body_file"
if [ -n "$blockers_id" ]; then
  gh api --method PATCH "/repos/$SHIP_REPO/issues/comments/$blockers_id" --input "$body_file" >/dev/null || {
    rm -f "$body_file"
    echo "::warning::could not edit the $BLOCKED_MARKER comment on pull request $pr"
    exit 1
  }
  rm -f "$body_file"
  decided updated "$why"
fi
gh api --method POST "/repos/$SHIP_REPO/issues/$pr/comments" --input "$body_file" >/dev/null || {
  rm -f "$body_file"
  echo "::warning::could not comment on pull request $pr"
  exit 1
}
rm -f "$body_file"
decided posted "$why"

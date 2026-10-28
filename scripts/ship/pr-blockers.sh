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
#     annotation — the `Why it failed` line scripts/ship/check-summary.sh writes
#     — else its first other error, else its output title, else "see the run",
#     written as a code span, since the pull request's own code wrote it. The
#     next step is this copy's check-summary.sh table. A pending check is not a
#     blocker.
#   - the review, by where it stands (SIGNAL_REVIEW from review-state.sh, else
#     the claude-review check run's title on the head): changes requested is
#     "Review asked for changes (round N)" with a link to the Problems found
#     comment (<!-- claude-review-status -->), broke says the review broke, and
#     any other red but cancelled says it ended without a verdict. A passed
#     review is no line, and nor is a cancelled one: a newer review replaced it.
#   - the video's runs for the head, only while the review is passed (or there
#     is none yet): the newest PR video record run and the newest PR video
#     publish run (found by the name pr-video-publish.yml gives it). While the
#     review is not green, the review's own line is the wake.
#   - `blocked` only: SIGNAL_WHAT, the run that just failed, when the lookups
#     above did not already list it. A cancelled review (SIGNAL_CONCLUSION) was
#     replaced by a newer one, and a video failure while the review is not
#     passed is not a second wake: both say nothing and write nothing.
#
# With nothing left, an existing comment becomes "No blockers on <sha7>"; a pull
# request that never had a blocker gets no comment at all.
#
# Workflow runs are read with RUNS_TOKEN when it is set (the job's own token,
# actions: read — the app has no Actions permission), else GH_TOKEN. A lookup
# that cannot be read is a warning, not a stop: the comment says what it can.

: "${pr:?}" "${pr_head:?}" "${mode:?}" "${here:?}"

review_state="${SIGNAL_REVIEW:-}"
if [ "$mode" = blocked ]; then
  case "$SIGNAL_WHAT" in
    'Claude review')
      [ "${SIGNAL_CONCLUSION:-}" != cancelled ] ||
        decided skip "the Claude review run on pull request $pr was cancelled by a newer one"
      ;;
    'PR video record' | 'PR video publish')
      [ -z "$review_state" ] || [ "$review_state" = passed ] ||
        decided skip "the review of pull request $pr is $review_state, not passed, so its own signal is the one to wake for"
      ;;
  esac
fi

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
    cancelled) echo ' was cancelled' ;;
    timed_out) echo ' timed out' ;;
    note) echo '' ;;
    *) echo ' failed' ;;
  esac
}

blocker_lines=''
blocker_names=' '
review_url=''
# blocker <what> <conclusion|note> <reason> <url> <next>: one line, in the words
# the check page and the signal have always used: the reason, Run: and Next:.
blocker() {
  local reason="$3" url="$4" next="$5" run=''
  reason="$(printf '%s' "$reason" | tr '\r\n' '  ' | tr -s ' ' | sed 's/^ //; s/ $//; s/[.]$//')"
  next="$(printf '%s' "$next" | sed 's/[.]$//')"
  [ -n "$reason" ] || reason='see the run'
  [ -z "$url" ] || run=" Run: $url."
  blocker_lines="${blocker_lines}- **$1**$(blockers_verb "$2"): $reason.$run Next: $next."$'\n'
  blocker_names="$blocker_names$1 "
}

# review_blocker <state> <run url>: the review's line, by where it stands.
review_blocker() {
  local problems="${review_comment_url:-the Problems found comment on this pull request}"
  case "$1" in
    passed) ;;
    changes-requested)
      blocker 'Claude review' note "Review asked for changes (round ${SIGNAL_ROUND:-?}). Problems found: $problems" \
        "$2" "fix them and push; the push starts a fresh review" ;;
    broke)
      blocker 'Claude review' note "review broke: the Claude review did not finish, so it is not a round" \
        "$2" "re-run it" ;;
    *)
      blocker 'Claude review' note "the Claude review ended without a verdict (state: ${1:-none}), so nothing was reviewed" \
        "$2" "$(blockers_next_for 'Claude review')" ;;
  esac
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
           title: (.output.title // "")} | @json' 2>/dev/null)" || {
  echo "::warning::could not read the check runs on $pr_head; the blockers comment lists what it can"
  blockers_checks=''
}

# The first error annotation: check-summary.sh's `Why it failed` line when there
# is one, else the first error that is not the runner's own exit-code line.
annotation_jq='[.[]? | select(.annotation_level == "failure")]
  | ([.[] | select(.title == "Why it failed")]
     + [.[] | select((.message // "") | test("^Process completed with exit code") | not)])
  | (.[0].message // "") | split("\n") | .[0] // ""'
# check_reason <id> <title>: the reason, from the check run's annotations, as a
# code span. A pull request's own ci.yml writes that text, so it reaches the
# app's comment as plain code: no @mention, link or markdown of the head's own
# gets into it. The next step after it is never read from the annotation: it is
# this copy's own table (blockers_next_for), the base commit's.
check_reason() {
  local found tick='`'
  # The title, not the text, marks check-summary.sh's own line.
  found="$(gh api "/repos/$SHIP_REPO/check-runs/$1/annotations?per_page=50" --jq "$annotation_jq" 2>/dev/null)" || found=''
  [ -n "$found" ] || found="$2"
  found="${found%% Next: *}"
  found="$(printf '%s' "$found" | tr '\r\n`' '   ' | tr -s ' ' | sed 's/^ //; s/ $//; s/[.]$//')"
  [ -z "$found" ] || printf '%s%s%s' "$tick" "$found" "$tick"
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
    # A cancelled review was replaced by a newer one: it says nothing, on this
    # path as on the blocked one (SIGNAL_CONCLUSION).
    [ "$conclusion" != cancelled ] || continue
    review_url="$url"
    if [ -z "$review_state" ]; then
      case "$(jq -r '.title' <<<"$row")" in
        *'changes requested'*) review_state=changes-requested ;;
        *broke*) review_state=broke ;;
        *) review_state=failed ;;
      esac
    fi
    continue
  fi
  reason="$(check_reason "$(jq -r '.id' <<<"$row")" "$(jq -r '.title' <<<"$row")")"
  blocker "$want" "$conclusion" "$reason" "$url" "$(blockers_next_for "$want")"
done

if [ -n "$review_state" ] && [ "$review_state" != passed ] && [ "$review_state" != none ]; then
  review_blocker "$review_state" "${SIGNAL_RUN_URL:-${review_url:-}}"
fi

# The video's own runs for this head, newest first: a red one is a blocker until
# a newer run for the same head comes back clean.
newest_run() {
  blockers_runs_api "$1" --jq "$2"' | sort_by(.created_at // "", .id) | last
    | select(. != null) | [.status, (.conclusion // ""), (.html_url // "")] | @tsv' 2>/dev/null
}
video_counts=1
case "$review_state" in '' | passed | none) ;; *) video_counts=0 ;; esac
if [ "$video_counts" = 0 ]; then
  :
elif row="$(newest_run "/repos/$SHIP_REPO/actions/workflows/pr-video-record.yml/runs?head_sha=$pr_head&per_page=30" \
  '[.workflow_runs[]? | select(.head_sha == "'"$pr_head"'")]')"; then
  IFS=$'\t' read -r st con url <<<"$row"
  if [ "${st:-}" = completed ] && red "${con:-}"; then
    blocker 'PR video record' "$con" 'the recording of the explainer video failed, so no video was made' "$url" "$(blockers_next_for 'PR video record')"
  fi
else
  echo "::warning::could not read the PR video record runs for $pr_head"
fi
publish_name="$(ship_video_publish_name "$pr" "$pr_head")"
if [ "$video_counts" = 0 ]; then
  :
elif row="$(newest_run "/repos/$SHIP_REPO/actions/workflows/pr-video-publish.yml/runs?per_page=30" \
  '[.workflow_runs[]? | select(.display_title == "'"$publish_name"'")]')"; then
  IFS=$'\t' read -r st con url <<<"$row"
  if [ "${st:-}" = completed ] && red "${con:-}"; then
    blocker 'PR video publish' "$con" "the explainer video was not published: the narration, the voice, the audio gate or the upload failed (the run's gate report names which)" "$url" "$(blockers_next_for 'PR video publish')"
  fi
else
  echo "::warning::could not read the PR video publish runs for $pr_head"
fi

# The run that just failed, when the lookups above did not list it already.
if [ "$mode" = blocked ]; then
  case "$blocker_names" in
    *" $SIGNAL_WHAT "*) ;;
    *)
      case "$SIGNAL_WHAT" in
        'Claude review') review_blocker "$review_state" "${SIGNAL_RUN_URL:-}" ;;
        'PR video record')
          blocker "$SIGNAL_WHAT" failure 'the recording of the explainer video failed, so no video was made' \
            "${SIGNAL_RUN_URL:-}" "$(blockers_next_for "$SIGNAL_WHAT")" ;;
        'PR video publish')
          blocker "$SIGNAL_WHAT" failure "the explainer video was not published: the narration, the voice, the audio gate or the upload failed (the run's gate report names which)" \
            "${SIGNAL_RUN_URL:-}" "$(blockers_next_for "$SIGNAL_WHAT")" ;;
        *)
          blocker "$SIGNAL_WHAT" failure "the $SIGNAL_WHAT run did not come back clean" \
            "${SIGNAL_RUN_URL:-}" "$(blockers_next_for "$SIGNAL_WHAT")" ;;
      esac
      ;;
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
  [ -n "$blockers_id" ] || [ -n "${printing:-}" ] || decided none "pull request $pr has no blockers on $short, and no blockers comment to clear"
  text="$BLOCKED_MARKER
### PR blockers

No blockers on $short (head $pr_head)."
  why="pull request $pr has no blockers on $short"
fi

if [ -n "${printing:-}" ]; then
  printf '%s\n\n' "$text"
  decided printed "$why (printed, nothing written)"
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

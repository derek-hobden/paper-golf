#!/usr/bin/env bash
# Plain-English status for the claude-review job, on the pull request.
# One sticky comment (hidden marker <!-- claude-review-status -->). The same
# words go in $GITHUB_STEP_SUMMARY, and on a failure also in a ::error::
# annotation, so the red check shows the reason without opening the log.
#
#   review-status.sh explain   # classify, post or update, exit 1
#   review-status.sh pass      # update an existing comment to passed, exit 0
#
# explain reads the review log from $REVIEW_LOG and, unless REVIEW_SKIP_FETCH=1,
# this run's check annotations. A line that starts with ANTHROPIC_REVIEW_ERROR
# is the comment, word for word (an API key in it is redacted). The phrases
# below still win when that line is absent:
#   SECRET_OUTCOME=failure
#   WORKFLOW_CHANGED=1   (the PR edits .github/workflows/claude-review.yml)
#   VERDICT_PRESENT=0    and REVIEW_OUTCOME=success  (no claude-review-verdict.json)
# Anything else is a generic note with a link to the run.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,17p' "$0"; exit 0 ;; esac

MARKER='<!-- claude-review-status -->'
API_DETAIL=''

run_url() {
  printf '%s/%s/actions/runs/%s' \
    "${GITHUB_SERVER_URL:-https://github.com}" \
    "${GITHUB_REPOSITORY:-derek-hobden/paper-golf}" \
    "${GITHUB_RUN_ID:-0}"
}

# log_has <text> <extended-regex>: match without a pipe (pipefail + grep -q).
log_has() {
  grep -qiE -- "$2" <<<"$1"
}

fetch_annotations() {
  local repo ids id notes="" chunk
  repo="${GITHUB_REPOSITORY:-}"
  [ -n "$repo" ] || return 0
  [ -n "${GITHUB_RUN_ID:-}" ] || return 0
  ids="$(gh api "repos/${repo}/actions/runs/${GITHUB_RUN_ID}/jobs" --jq '.jobs[].id' 2>/dev/null || true)"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    chunk="$(gh api "repos/${repo}/check-runs/${id}/annotations" --jq '.[].message' 2>/dev/null || true)"
    notes="${notes}
${chunk}"
  done <<<"$ids"
  printf '%s' "$notes"
}

collected_log() {
  local text="" extra=""
  if [ -n "${REVIEW_LOG:-}" ] && [ -f "$REVIEW_LOG" ]; then
    text="$(cat "$REVIEW_LOG")"
  fi
  if [ "${REVIEW_SKIP_FETCH:-}" != 1 ]; then
    extra="$(fetch_annotations)"
  fi
  printf '%s\n%s\n' "$text" "$extra"
}

# The first ANTHROPIC_REVIEW_ERROR line, with the marker prefix removed.
api_detail() {
  local line
  while IFS= read -r line; do
    case "$line" in
      'ANTHROPIC_REVIEW_ERROR '*)
        printf '%s' "${line#ANTHROPIC_REVIEW_ERROR }"
        return 0
        ;;
    esac
  done <<<"$1"
}

redact_keys() {
  printf '%s\n' "$1" | sed -E 's/sk-ant-[A-Za-z0-9_-]+/[redacted]/g'
}

# Prints one class: api, workflow, bot, secret, noverdict, generic.
classify() {
  local text="$1"
  if log_has "$text" 'non-human actor'; then
    echo bot
    return 0
  fi
  if log_has "$text" 'ANTHROPIC_API_KEY is not set|Either ANTHROPIC_API_KEY'; then
    echo secret
    return 0
  fi
  if [ "${SECRET_OUTCOME:-}" = failure ]; then
    echo secret
    return 0
  fi
  if [ -n "$(api_detail "$text")" ]; then
    echo api
    return 0
  fi
  if log_has "$text" 'Exiting due to workflow validation skip|Skipping action due to workflow validation|Action skipped due to workflow validation|workflow_not_found_on_default_branch|workflow_content_mismatch|skipped_due_to_workflow_validation_mismatch'; then
    echo workflow
    return 0
  fi
  # The review exits 0 when this PR edits the workflow it runs, so a failed
  # review step is a different problem and keeps the generic message.
  if [ "${WORKFLOW_CHANGED:-}" = 1 ] && [ "${REVIEW_OUTCOME:-}" != failure ]; then
    echo workflow
    return 0
  fi
  if log_has "$text" 'claude-review-verdict\.json'; then
    echo noverdict
    return 0
  fi
  if [ "${VERDICT_PRESENT:-}" = 0 ] && [ "${REVIEW_OUTCOME:-}" = success ]; then
    echo noverdict
    return 0
  fi
  echo generic
}

message_for() {
  local url
  url="$(run_url)"
  case "$1" in
    api)
      printf '%s\n' "$API_DETAIL"
      ;;
    workflow)
      cat <<'EOF'
This PR changes the review's own workflow, so Claude can't review it. Derek needs to approve and merge with admin bypass.

The review action will not run while the pull request edits .github/workflows/claude-review.yml. It logs a workflow validation skip, so the reviewer cannot be rewritten by the pull request it is reviewing. Approve and merge with an admin bypass. The next pull request is reviewed as usual.
EOF
      ;;
    bot)
      cat <<'EOF'
Claude skipped this review because a bot started the workflow, and that bot is not allowed.

The action only runs for people and for the bots named in allowed_bots on the review workflow. It logs "Workflow initiated by non-human actor" for anyone else. Re-run the job from a person's account, or add that bot to allowed_bots and merge that workflow change with an admin bypass.
EOF
      ;;
    secret)
      cat <<'EOF'
The review did not run because the repo secret ANTHROPIC_API_KEY is not set.

Add it under Settings → Secrets and variables → Actions, then re-run this job.
EOF
      ;;
    noverdict)
      cat <<EOF
Claude did not finish the review: it left no claude-review-verdict.json.

The review step ended without a verdict, so there is nothing to count as a pass or a block. Open the run, see why it stopped, and re-run the job.
$url
EOF
      ;;
    pass)
      cat <<'EOF'
The Claude review passed on this run. It left no blocking comment.
EOF
      ;;
    *)
      cat <<EOF
The Claude review did not finish, and the log did not say why.

Open the run and read the review step. Re-run the job once the cause is fixed.
$url
EOF
      ;;
  esac
}

write_summary() {
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  printf '%s\n' "$1" >>"$GITHUB_STEP_SUMMARY"
}

# One annotation. Newlines are %0A so the check shows the same words.
write_error() {
  local flat="" line
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$flat" ]; then
      flat="${flat}%0A${line}"
    else
      flat="$line"
    fi
  done <<<"$1"
  printf '::error::%s\n' "$flat" >&2
}

existing_comment_id() {
  local repo pr ids id first=""
  repo="${GITHUB_REPOSITORY:?}"
  pr="${PR:?}"
  ids="$(gh api --paginate "repos/${repo}/issues/${pr}/comments" \
    --jq '.[] | select(.body | contains("<!-- claude-review-status -->")) | .id')"
  while IFS= read -r id; do
    if [ -n "$id" ]; then
      first="$id"
      break
    fi
  done <<<"$ids"
  printf '%s' "$first"
}

write_comment() {
  local id="$1" text="$2" repo pr body_file
  repo="${GITHUB_REPOSITORY:?}"
  pr="${PR:?}"
  body_file="$(mktemp)"
  # env.BODY, not a $ in the jq program: shellcheck SC2016.
  BODY="$(printf '%s\n\n%s\n' "$text" "$MARKER")" \
    jq -n '{body: env.BODY}' >"$body_file"
  if [ -n "$id" ]; then
    gh api --method PATCH --input "$body_file" "repos/${repo}/issues/${pr}/comments/${id}" >/dev/null
  else
    gh api --method POST --input "$body_file" "repos/${repo}/issues/${pr}/comments" >/dev/null
  fi
  rm -f "$body_file"
}

explain() {
  local text class msg id detail=''
  text="$(collected_log)"
  # classify runs in a command substitution, so its assignments do not stick.
  # The comment text has to be captured here, where message_for can see it.
  detail="$(api_detail "$text")"
  if [ -n "$detail" ]; then
    API_DETAIL="$(redact_keys "$detail")"
  else
    API_DETAIL=''
  fi
  class="$(classify "$text")"
  msg="$(message_for "$class")"
  write_summary "$msg"
  write_error "$msg"
  printf '%s\n' "$msg"
  if id="$(existing_comment_id)"; then
    write_comment "$id" "$msg" || echo "::warning::could not post the claude-review status comment" >&2
  else
    echo "::warning::could not post the claude-review status comment" >&2
  fi
  exit 1
}

pass() {
  local msg id
  msg="$(message_for pass)"
  write_summary "$msg"
  printf '%s\n' "$msg"
  if ! id="$(existing_comment_id)"; then
    echo "::warning::could not read the claude-review status comment" >&2
    exit 0
  fi
  [ -n "$id" ] || exit 0
  write_comment "$id" "$msg" || echo "::warning::could not update the claude-review status comment" >&2
}

case "${1:-}" in
  explain) explain ;;
  pass) pass ;;
  *) echo "usage: review-status.sh explain|pass (see --help)" >&2; exit 2 ;;
esac

#!/usr/bin/env bash
# Plain-English status for the claude-review job, on the pull request.
# One sticky comment (hidden marker <!-- claude-review-status -->). The same
# words go in $GITHUB_STEP_SUMMARY, and on a failure also in a ::error::
# annotation, so the red check shows the reason without opening the log.
#
#   review-status.sh explain   # classify, post or update, exit 1
#   review-status.sh pass      # update an existing comment to passed, exit 0
#   review-status.sh blocked   # the review blocked it ($BLOCKING), exit 0
#   review-status.sh incomplete  # the diff was cut, so the review read part of it
#                              # ($REVIEWED_CHARS of $TOTAL_CHARS), exit 0
#
# The comment is found, updated, or posted when there is none (sticky_comment).
# A run whose GITHUB_TOKEN cannot write — a pull request opened by Dependabot
# gets a read-only one — says so in the step summary instead of dropping gh's
# bare "Not Found (HTTP 404)" in the log. Only explain fails the step; pass and
# blocked exit 0, so the verdict stays with the job's own last step.
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
case "${1:-}" in -h | --help) sed -n '2,26p' "$0"; exit 0 ;; esac

MARKER='<!-- claude-review-status -->'
API_DETAIL=''
# Every gh call that writes or reads the comment sends its stderr here, so a
# bare "gh: Not Found (HTTP 404)" never lands in the job log on its own.
# A file, not a variable: the read runs inside $(...), which cannot set one.
GH_ERR="$(mktemp)"
trap 'rm -f "$GH_ERR"' EXIT

# The last such call's error, on one line.
gh_error() {
  tr '\n' ' ' <"$GH_ERR" | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

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
  ids="$(gh api "repos/${repo}/actions/runs/${GITHUB_RUN_ID}/jobs" --jq '.jobs[].id' 2>/dev/null)" || ids=''
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    chunk="$(gh api "repos/${repo}/check-runs/${id}/annotations" --jq '.[].message' 2>/dev/null)" || chunk=''
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
  # The review still runs from main when this pull request edits the workflow.
  # A failed review step is a different problem and keeps the generic message.
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
  local url count=''
  url="$(run_url)"
  case "$1" in
    api)
      printf '%s\n' "$API_DETAIL"
      ;;
    workflow)
      cat <<'EOF'
The review did not run, so this check fails. A pull request cannot skip it by editing the workflow or the review script.

This job runs the copy of the reviewer on main. A workflow validation skip is not a pass. Re-run the job.
EOF
      ;;
    bot)
      cat <<'EOF'
Claude skipped this review because a bot started the workflow, and that bot is not allowed.

The action only runs for people and for the bots named in allowed_bots on the review workflow. It logs "Workflow initiated by non-human actor" for anyone else. Re-run the job from a person's account, or add that bot to allowed_bots.
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
    blocked)
      # A count only when it is one, so a lost output never reads as "0".
      case "${BLOCKING:-}" in
        '' | *[!0-9]* | 0) count='' ;;
        *) count=" ${BLOCKING}" ;;
      esac
      cat <<EOF
The Claude review left${count} blocking comment(s) on this run.

Each one is a review comment on the diff. Push a fix, or reply on the comment if it is wrong; the check goes green on the next run that leaves none.
EOF
      ;;
    incomplete)
      cat <<EOF
The Claude review was incomplete: the diff is ${TOTAL_CHARS:-?} characters and the reviewer reads at most ${REVIEWED_CHARS:-?}, so part of this change was never reviewed. It does not count as a pass, so ready-gate stays red.

Split the pull request so each part fits, then mark it ready again (or add the \`ready\` label).
$url
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

# GitHub's routes for one issue comment are not symmetrical: it is listed and
# created under the issue, but updated on its own path. The nested edit path
# (issues/<pr>/comments/<id>) is not a route at all, so it answered 404 and the
# comment never refreshed after the first run.
comments_path() { printf 'repos/%s/issues/%s/comments' "${GITHUB_REPOSITORY:?}" "${PR:?}"; }
comment_path() { printf 'repos/%s/issues/comments/%s' "${GITHUB_REPOSITORY:?}" "$1"; }

# The id of the marker comment, empty when the pull request has none.
# Returns 1 when the comments cannot be read at all.
existing_comment_id() {
  local ids id first=""
  ids="$(gh api --paginate "$(comments_path)" \
    --jq ".[] | select(.body | contains(\"$MARKER\")) | .id" 2>"$GH_ERR")" || return 1
  while IFS= read -r id; do
    if [ -n "$id" ]; then
      first="$id"
      break
    fi
  done <<<"$ids"
  printf '%s' "$first"
}

# POST or PATCH the comment body. Returns gh's status, with its error in $GH_ERR.
api_write() {
  local status=0
  gh api --method "$1" --input "$2" "$3" >/dev/null 2>"$GH_ERR" || status=$?
  return "$status"
}

# Update the marker comment, or post one when $1 is empty. Returns 1 when the
# token cannot write it.
write_comment() {
  local id="$1" text="$2" body_file status=0
  body_file="$(mktemp)"
  # env.BODY, not a $ in the jq program: shellcheck SC2016.
  BODY="$(printf '%s\n\n%s\n' "$text" "$MARKER")" \
    jq -n '{body: env.BODY}' >"$body_file"
  if [ -n "$id" ]; then
    if api_write PATCH "$body_file" "$(comment_path "$id")"; then
      rm -f "$body_file"
      return 0
    fi
    # 404 on the edit means that comment is gone: post a fresh one. Any other
    # refusal is the token, and posting would be refused the same way.
    if ! log_has "$(gh_error)" 'HTTP 404'; then
      rm -f "$body_file"
      return 1
    fi
  fi
  api_write POST "$body_file" "$(comments_path)" || status=$?
  rm -f "$body_file"
  return "$status"
}

# Why there is no comment, in plain English, in the step summary and as a
# warning. Never gh's bare line on its own: the status itself is in the summary.
unwritable() {
  local note why
  why="$(gh_error)"
  [ -z "$why" ] || why=" ($why)"
  note="$(printf '%s\n' "Note: $1$why. The status is in this step summary instead." \
    "A pull request opened by Dependabot runs with a read-only GITHUB_TOKEN, which cannot comment; re-run the job from a person's account to refresh the comment.")"
  write_summary "$note"
  printf '%s\n' "$note"
  echo "::warning::$1" >&2
}

# One sticky comment with this text: find it, update it, or post the first one.
sticky_comment() {
  local id
  if ! id="$(existing_comment_id)"; then
    unwritable "could not read the comments on pull request ${PR:-?}"
    return 0
  fi
  write_comment "$id" "$1" ||
    unwritable "could not write the Claude review status comment on pull request ${PR:-?}"
}

explain() {
  local text class msg detail=''
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
  sticky_comment "$msg"
  exit 1
}

# A green run updates the comment the run before it left, and posts none when
# there is nothing to correct: a clean pull request stays quiet.
pass() {
  local msg id
  msg="$(message_for pass)"
  write_summary "$msg"
  printf '%s\n' "$msg"
  if ! id="$(existing_comment_id)"; then
    unwritable "could not read the comments on pull request ${PR:-?}"
    exit 0
  fi
  [ -n "$id" ] || exit 0
  write_comment "$id" "$msg" ||
    unwritable "could not write the Claude review status comment on pull request ${PR:-?}"
}

# The review finished and left blocking comments. The comment says so rather
# than keeping the words of the run before it; the job's last step fails the
# check, so the step summary there has the count and the reason.
blocked() {
  local msg
  msg="$(message_for blocked)"
  printf '%s\n' "$msg"
  sticky_comment "$msg"
}

# The review finished on a cut diff. Its verdict covers part of the change, so
# the comment says so; the job's last step fails the check.
incomplete() {
  local msg
  msg="$(message_for incomplete)"
  write_summary "$msg"
  printf '%s\n' "$msg"
  sticky_comment "$msg"
}

case "${1:-}" in
  explain) explain ;;
  pass) pass ;;
  blocked) blocked ;;
  incomplete) incomplete ;;
  *) echo "usage: review-status.sh explain|pass|blocked|incomplete (see --help)" >&2; exit 2 ;;
esac

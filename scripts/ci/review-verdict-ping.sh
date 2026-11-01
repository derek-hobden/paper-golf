#!/usr/bin/env bash
# Usage: review-verdict-ping.sh <verdict> [reason]
#        review-verdict-ping.sh --from-posted-review
# Repo-neutral: the verdict is a word, so any CI review can call it right after the review is posted.
#   verdict: APPROVE|APPROVED|approved|passed|pass        -> kind approved
#            REQUEST_CHANGES|CHANGES_REQUESTED|changes_requested|changes-requested|blocked -> kind changes_requested
#            anything else (COMMENT, broke, empty)         -> no ping
# --from-posted-review: for repos whose review step posts the review itself. Reads the newest review by
#   REVIEWER (default github-actions[bot]) on HEAD_SHA with `gh api` (needs GH_TOKEN) and uses its state
#   and first body line. Reviews posted with GITHUB_TOKEN start no workflow, so bot-ping-pr-review.yml never
#   sees them; the review job pings the owning bot itself.
# Env: REPO, PR_NUMBER, HEAD_SHA, PR_AUTHOR, PR_BRANCH, PR_URL, REVIEW_URL (optional), BOT_LOGINS/BOT_AUTHORS,
# BOT_BRANCH_PREFIXES, BOT_WEBHOOK_URL, BOT_WEBHOOK_KEY. Needs is-bot-pr.sh and bot-event-ping.sh beside it.
# Never fails the job.
dir="$(cd "$(dirname "$0")" && pwd)"
verdict="${1:-}"; reason="${2:-}"
if [ "$verdict" = --from-posted-review ]; then
  who="${REVIEWER:-github-actions[bot]}"
  line="$(gh api --paginate "repos/${REPO:-}/pulls/${PR_NUMBER:-}/reviews" 2>/dev/null \
    | jq -rs --arg who "$who" --arg sha "${HEAD_SHA:-}" \
      '[.[][] | select(.user.login==$who and .commit_id==$sha)] | last // empty
       | [.state, .html_url, ((.body // "") | split("\n")[0])] | @tsv' 2>/dev/null)" || line=""
  [ -n "$line" ] || { echo "review-verdict-ping: no review by $who on ${HEAD_SHA:-?}, no ping"; exit 0; }
  IFS=$'\t' read -r verdict url reason <<<"$line"
  REVIEW_URL="${REVIEW_URL:-$url}"
fi
case "$verdict" in
  APPROVE|APPROVED|approved|passed|pass) kind=approved ;;
  REQUEST_CHANGES|CHANGES_REQUESTED|changes_requested|changes-requested|blocked) kind=changes_requested ;;
  *) echo "review-verdict-ping: verdict '$verdict' not approve/request_changes, no ping"; exit 0 ;;
esac
if ! bash "$dir/is-bot-pr.sh" "${PR_AUTHOR:-}" "${PR_BRANCH:-}"; then
  echo "review-verdict-ping: human PR, no ping"; exit 0
fi
reason="$(printf '%s' "$reason" | tr '\n\r\t' '   ' | cut -c1-280)"
payload="$(jq -nc --arg kind "$kind" --arg repo "${REPO:-}" --arg pr "${PR_NUMBER:-}" \
  --arg sha "${HEAD_SHA:-}" --arg reason "$reason" --arg author "${PR_AUTHOR:-}" \
  --arg branch "${PR_BRANCH:-}" --arg pr_url "${PR_URL:-}" --arg review_url "${REVIEW_URL:-}" \
  '{kind:$kind,waiting:false,repo:$repo,pr:($pr|tonumber? // $pr),head_sha:$sha,
    state:$kind,reviewer:"github-actions[bot]",reason:$reason,author:$author,branch:$branch,
    pr_url:$pr_url,review_url:$review_url,ts:(now|floor)}')" || { echo "review-verdict-ping: jq failed, no ping"; exit 0; }
bash "$dir/bot-event-ping.sh" "$payload"
exit 0

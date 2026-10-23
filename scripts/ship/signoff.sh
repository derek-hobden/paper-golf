#!/usr/bin/env bash
# The signoff check. It passes when derek-hobden has an APPROVED review of
# the current head commit, or a pull request comment from him whose text is
# exactly /approve and which was posted after that commit. A review of an
# older commit does not count, and this script dismisses those stale
# approvals. A new push needs a new approval. A label is not an approval.
# Every pull request, whatever its risk, needs one of those two.
#
#   bash scripts/ship/signoff.sh <head> <pr>
#
# Exit 0 when that approval is on the head, 1 when it is not or the pull
# request cannot be read, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,12p' "$0"; exit 0 ;; esac
[ $# -eq 2 ] || { echo "usage: signoff.sh <head> <pr>" >&2; exit 2; }
head="$1"
pr="$2"
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "pr must be a number" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

if [[ "$head" =~ ^[0-9a-f]{40}$ ]]; then
  head_sha="$head"
else
  head_sha="$(git rev-parse "$head^{commit}")" || { echo "cannot resolve $head" >&2; exit 1; }
fi

# Pages of reviews. Cap the walk so a full page cannot loop forever.
page=1
reviews='[]'
while [ "$page" -le 5 ]; do
  chunk="$(gh api "/repos/$SHIP_REPO/pulls/$pr/reviews?per_page=100&page=$page" --jq '.')" || {
    echo "cannot read reviews for #$pr" >&2
    exit 1
  }
  reviews="$(jq --argjson more "$chunk" '. + $more' <<<"$reviews")"
  count="$(jq 'length' <<<"$chunk")"
  [ "$count" -eq 100 ] || break
  page=$((page + 1))
done

# A new push leaves his approval on the old commit. Dismiss it so the pull
# request no longer shows that approval. A refusal still fails the check below.
stale="$(jq -r --arg head "$head_sha" '
  .[] | select(.user.login == "derek-hobden" and .state == "APPROVED" and .commit_id != $head) | (.id | tostring)
' <<<"$reviews")"
while IFS= read -r id; do
  [ -n "$id" ] || continue
  gh api --method PUT "/repos/$SHIP_REPO/pulls/$pr/reviews/$id/dismissals" \
    -f "message=A new commit replaced the head this approval was on." \
    -f event=DISMISS >/dev/null 2>&1 || true
done <<<"$stale"

# The latest review of his on this head, ignoring a bare comment. That is the
# one that has to be APPROVED.
state="$(jq -r --arg head "$head_sha" '
  [ .[] | select(
      .user.login == "derek-hobden" and
      .commit_id == $head and
      .state != "COMMENTED" and
      .state != "PENDING"
    )
  ] | sort_by(.submitted_at // "") | last | .state // ""
' <<<"$reviews")"

if [ "$state" = APPROVED ]; then
  echo "signoff=pass"
  echo "reason=approved by derek-hobden on $head_sha"
  exit 0
fi

# He cannot approve a pull request he opened. A conversation comment whose
# text is exactly /approve, posted after this commit, is the other way.
commit="$(gh api "/repos/$SHIP_REPO/commits/$head_sha" --jq '.')" || {
  echo "cannot read commit $head_sha" >&2
  exit 1
}
head_date="$(jq -r '.commit.committer.date // .commit.author.date // empty' <<<"$commit")"
[ -n "$head_date" ] || { echo "commit $head_sha has no date" >&2; exit 1; }

page=1
comments='[]'
while [ "$page" -le 5 ]; do
  chunk="$(gh api "/repos/$SHIP_REPO/issues/$pr/comments?per_page=100&page=$page" --jq '.')" || {
    echo "cannot read comments for #$pr" >&2
    exit 1
  }
  comments="$(jq --argjson more "$chunk" '. + $more' <<<"$comments")"
  count="$(jq 'length' <<<"$chunk")"
  [ "$count" -eq 100 ] || break
  page=$((page + 1))
done

if jq -e --arg date "$head_date" '
  any(.[];
    (.user.login // "") == "derek-hobden" and
    .body == "/approve" and
    ((.created_at // "") | test("^[0-9]{4}-")) and
    (.created_at | fromdateiso8601) > ($date | fromdateiso8601))
' <<<"$comments" >/dev/null; then
  echo "signoff=pass"
  echo "reason=/approve comment by derek-hobden after $head_sha"
  exit 0
fi
echo "signoff=fail" >&2
echo "reason=derek-hobden has no APPROVED review on $head_sha and no /approve comment after it" >&2
exit 1

#!/usr/bin/env bash
# The signoff check. risk:low passes on its own. risk:high (the diff, or the
# risk:high label) passes when derek-hobden has an APPROVED review on the
# current head commit. A new commit dismisses that approval. The signed-off
# label is the fallback for a bot relaying his approval: it counts only when
# the latest signed-off issue event is a labeled event by derek-hobden.
#
#   bash scripts/ship/signoff.sh <base> <head> <pr>
#
# Exit 0 when the check passes, 1 when a risk:high PR is not signed off, 2 on
# a usage error. A doubt on a risk:high PR fails the check.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,11p' "$0"; exit 0 ;; esac
[ $# -eq 3 ] || { echo "usage: signoff.sh <base> <head> <pr>" >&2; exit 2; }
base="$1"
head="$2"
pr="$3"
[[ "$pr" =~ ^[0-9]+$ ]] || { echo "pr must be a number" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

gh label create signed-off --color 0e8a16 --description "Derek signed off this risk:high PR (CLAUDE.md)" --force >/dev/null

verdict="$(bash "$here/pr-risk.sh" "$base" "$head")"
risk="$(printf '%s\n' "$verdict" | awk -F= '$1 == "risk" { print $2; exit }')"
[ "$risk" = low ] || [ "$risk" = high ] || { echo "pr-risk.sh did not say low or high" >&2; exit 1; }

labels="$(gh api "/repos/$SHIP_REPO/issues/$pr" --jq '[.labels[].name]')" || {
  echo "cannot read labels for #$pr" >&2
  exit 1
}
high_label=0
if jq -e 'index("risk:high")' <<<"$labels" >/dev/null; then high_label=1; fi

if [ "$risk" = low ] && [ "$high_label" = 0 ]; then
  echo "signoff=pass"
  echo "reason=risk:low"
  exit 0
fi

head_sha="$(git rev-parse "$head^{commit}")" || {
  echo "cannot resolve $head" >&2
  exit 1
}

# Pages of reviews. Cap the walk so a full page cannot loop forever.
# An APPROVED review counts only on this head: a later push dismisses it,
# and a review of an older commit is not this head even if it still says APPROVED.
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

approved="$(REVIEWS="$reviews" HEAD_SHA="$head_sha" node -e '
  const reviews = JSON.parse(process.env.REVIEWS ?? "[]");
  const head = process.env.HEAD_SHA ?? "";
  const list = Array.isArray(reviews) ? reviews : [];
  const mine = list.filter((r) =>
    !!r && !!r.user && r.user.login === "derek-hobden" &&
    r.commit_id === head && r.state !== "COMMENTED" && r.state !== "PENDING");
  mine.sort((a, b) => String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")));
  const last = mine[mine.length - 1];
  process.stdout.write(last && last.state === "APPROVED" ? "yes" : "no");
')"

if [ "$approved" = yes ]; then
  echo "signoff=pass"
  echo "reason=approved by derek-hobden on $head_sha"
  exit 0
fi

# Pages of issue events. Cap the walk so a full page cannot loop forever.
page=1
events='[]'
while [ "$page" -le 5 ]; do
  chunk="$(gh api "/repos/$SHIP_REPO/issues/$pr/events?per_page=100&page=$page" --jq '.')" || {
    echo "cannot read issue events for #$pr" >&2
    exit 1
  }
  events="$(jq --argjson more "$chunk" '. + $more' <<<"$events")"
  count="$(jq 'length' <<<"$chunk")"
  [ "$count" -eq 100 ] || break
  page=$((page + 1))
done

present=0
if jq -e 'index("signed-off")' <<<"$labels" >/dev/null; then present=1; fi
ok="$(EVENTS="$events" node -e '
  const events = JSON.parse(process.env.EVENTS ?? "[]");
  const rel = events.filter((e) =>
    (e.event === "labeled" || e.event === "unlabeled") && e.label && e.label.name === "signed-off");
  rel.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const last = rel[rel.length - 1];
  const pass = !!last && last.event === "labeled" && last.actor && last.actor.login === "derek-hobden";
  process.stdout.write(pass ? "yes" : "no");
')"

if [ "$present" = 1 ] && [ "$ok" = yes ]; then
  echo "signoff=pass"
  echo "reason=signed-off by derek-hobden"
  exit 0
fi
echo "signoff=fail" >&2
echo "risk:high needs derek-hobden's APPROVED review on $head_sha, or the signed-off label added by him" >&2
exit 1

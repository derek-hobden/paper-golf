#!/usr/bin/env bash
# Simulates a Claude review verdict and checks the ping payload, with curl stubbed on PATH.
# Run: bash scripts/__tests__/review-verdict-ping.test.sh
# Self-contained: copies scripts/ci/review-verdict-ping.sh into a temp dir and uses the repo's own
# is-bot-pr.sh / bot-event-ping.sh when present, else minimal stand-ins, so it passes from the
# template and from any repo that has the script copied. curl and gh are stubbed; nothing leaves the box.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/ci"; S="$T/ci/review-verdict-ping.sh"
[ -f "$ROOT/scripts/ci/review-verdict-ping.sh" ] || { echo "FAIL scripts/ci/review-verdict-ping.sh missing in $ROOT"; exit 1; }
cp "$ROOT/scripts/ci/review-verdict-ping.sh" "$S"
if [ -f "$ROOT/scripts/ci/is-bot-pr.sh" ]; then cp "$ROOT/scripts/ci/is-bot-pr.sh" "$T/ci/"; else cat > "$T/ci/is-bot-pr.sh" <<'B'
#!/usr/bin/env bash
logins="${BOT_LOGINS:-${BOT_AUTHORS:-}}"; for l in ${logins//,/ }; do [ "$1" = "$l" ] && exit 0; done
for p in ${BOT_BRANCH_PREFIXES//,/ }; do case "$2" in "$p"*) exit 0;; esac; done; exit 1
B
fi
if [ -f "$ROOT/scripts/ci/bot-event-ping.sh" ]; then cp "$ROOT/scripts/ci/bot-event-ping.sh" "$T/ci/"; else cat > "$T/ci/bot-event-ping.sh" <<'B'
#!/usr/bin/env bash
[ -n "${BOT_WEBHOOK_URL:-}" ] && [ -n "${BOT_WEBHOOK_KEY:-}" ] || { echo "bot-event-ping: secrets not set, skipped"; exit 0; }
code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BOT_WEBHOOK_KEY" --data "$1" "$BOT_WEBHOOK_URL" 2>/dev/null)" || true
echo "bot ping http=${code:-000}"
B
fi
cat > "$T/gh" <<'G'
#!/usr/bin/env bash
cat "$GH_REVIEWS"
G
chmod +x "$T/gh"
cat > "$T/curl" <<'C'
#!/usr/bin/env bash
while [ $# -gt 0 ]; do case "$1" in --data) printf '%s' "$2" > "$CURL_OUT"; shift;; -H) echo "$2" >> "$CURL_OUT.h"; shift;; esac; shift; done
printf 200
C
chmod +x "$T/curl"
export PATH="$T:$PATH" CURL_OUT="$T/body" BOT_WEBHOOK_URL=https://hook.example/x BOT_WEBHOOK_KEY=k
export REPO=o/r PR_NUMBER=4152 HEAD_SHA=4a419244f2d08e0c5bc6f30170e630ad9184b8fa PR_AUTHOR=derek-hobden \
  PR_BRANCH=claude/x BOT_LOGINS="" BOT_BRANCH_PREFIXES="claude/"
pass=0 fail=0
ok() { if eval "$2"; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1"; fi; }
reset() { rm -f "$T/body" "$T/body.h"; }
reset; out=$(bash "$S" REQUEST_CHANGES $'Risk: auth\nmore'); b=$(cat "$T/body" 2>/dev/null)
ok "changes_requested logs http=200" '[[ "$out" == *"bot ping http=200"* ]]'
ok "kind=changes_requested" '[ "$(jq -r .kind <<<"$b")" = changes_requested ]'
ok "pr number" '[ "$(jq -r .pr <<<"$b")" = 4152 ]'
ok "head sha" '[ "$(jq -r .head_sha <<<"$b")" = "$HEAD_SHA" ]'
ok "short reason, one line" '[ "$(jq -r .reason <<<"$b")" = "Risk: auth more" ]'
ok "bearer header" 'grep -q "Authorization: Bearer k" "$T/body.h"'
reset; bash "$S" APPROVE "lgtm" >/dev/null; ok "approved kind" '[ "$(jq -r .kind "$T/body")" = approved ]'
reset; long=$(printf 'a%.0s' {1..500}); bash "$S" APPROVE "$long" >/dev/null
ok "reason capped at 280" '[ "$(jq -r ".reason|length" "$T/body")" = 280 ]'
reset; out=$(PR_BRANCH=feature/x bash "$S" REQUEST_CHANGES r); ok "human PR: no ping" '[ ! -f "$T/body" ] && [[ "$out" == *"human PR"* ]]'
reset; out=$(PR_BRANCH=feature/x BOT_LOGINS="mel-bot" PR_AUTHOR=mel-bot bash "$S" APPROVE r); ok "bot login matches" '[ -f "$T/body" ]'
reset; out=$(bash "$S" COMMENT r); ok "comment verdict: no ping" '[ ! -f "$T/body" ]'
reset; out=$(BOT_WEBHOOK_URL= bash "$S" APPROVE r); rc=$?; ok "no secrets: skipped, exit 0" '[ $rc = 0 ] && [ ! -f "$T/body" ] && [[ "$out" == *skipped* ]]'
reset; bash "$S" passed "ok" >/dev/null; ok "paper-golf word passed -> approved" '[ "$(jq -r .kind "$T/body")" = approved ]'
reset; bash "$S" changes-requested "x" >/dev/null; ok "changes-requested -> changes_requested" '[ "$(jq -r .kind "$T/body")" = changes_requested ]'
reset; out=$(bash "$S" broke r); ok "broke: no ping" '[ ! -f "$T/body" ]'
export GH_REVIEWS="$T/reviews.json"
jq -n --arg sha "$HEAD_SHA" '[{user:{login:"github-actions[bot]"},commit_id:"old",state:"APPROVED",body:"old",html_url:"u0"},
  {user:{login:"github-actions[bot]"},commit_id:$sha,state:"CHANGES_REQUESTED",body:"Fix auth\nmore",html_url:"https://gh/r/1"},
  {user:{login:"someone"},commit_id:$sha,state:"APPROVED",body:"x",html_url:"u2"}]' > "$GH_REVIEWS"
reset; bash "$S" --from-posted-review >/dev/null; b=$(cat "$T/body" 2>/dev/null)
ok "from posted review: kind" '[ "$(jq -r .kind <<<"$b")" = changes_requested ]'
ok "from posted review: reason first line" '[ "$(jq -r .reason <<<"$b")" = "Fix auth" ]'
ok "from posted review: review_url" '[ "$(jq -r .review_url <<<"$b")" = "https://gh/r/1" ]'
reset; out=$(HEAD_SHA=nope bash "$S" --from-posted-review); ok "no review on head: no ping" '[ ! -f "$T/body" ] && [[ "$out" == *"no review"* ]]'
echo "[]" > "$GH_REVIEWS"; reset; out=$(bash "$S" --from-posted-review); rc=$?; ok "empty reviews: exit 0" '[ $rc = 0 ] && [ ! -f "$T/body" ]'
echo "pass=$pass fail=$fail"; [ $fail = 0 ]

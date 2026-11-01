#!/usr/bin/env bash
# Usage: bot-event-ping.sh '<json payload>'. POSTs to $BOT_WEBHOOK_URL with Bearer $BOT_WEBHOOK_KEY.
# Never fails the job, never prints URL/key. Skips quietly when the secrets aren't set.
# Logs one line, `bot ping http=NNN` (the HTTP status; 000 when the webhook was not reached), the
# same line as every bot-ping-*.yml workflow (tests/bot-ping-log-wording.test.ts).
payload="${1:-{\}}"
[ -n "${BOT_WEBHOOK_URL:-}" ] && [ -n "${BOT_WEBHOOK_KEY:-}" ] || { echo "bot-event-ping: secrets not set, skipped"; exit 0; }
case "$BOT_WEBHOOK_URL" in https://*) ;; *) echo "bot-event-ping: non-https URL, skipped"; exit 0;; esac
# A failed POST: curl prints 000 itself and exits non-zero, so a fallback 000 after it logged 000000.
code="$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $BOT_WEBHOOK_KEY" --data "$payload" "$BOT_WEBHOOK_URL" 2>/dev/null)" || true
echo "bot ping http=${code:-000}"
exit 0

#!/usr/bin/env bash
# Factory session ping: tells the bot that started this Claude Code session that
# the session stopped, is waiting on someone, or ended.
#
# Called by the Stop, Notification and SessionEnd hooks in .claude/settings.json:
#   scripts/factory/session-ping.sh <hook_event> [note]
# The hook JSON arrives on stdin. Needs FACTORY_PING_URL and FACTORY_PING_KEY in
# the environment (set on the Claude cloud environment, never in the repo). If
# either is missing it does nothing. It never prints the URL or the key, never
# blocks, and always exits 0, so it can't hold up or break a session.
# FACTORY_PING_DEBUG=1 prints only the HTTP status (or "skipped") to stderr.

event="${1:-unknown}"
note="${2:-}"

debug() { [ "${FACTORY_PING_DEBUG:-}" = "1" ] && printf 'session-ping: %s\n' "$1" >&2; return 0; }

main() {
  if [ -z "${FACTORY_PING_URL:-}" ] || [ -z "${FACTORY_PING_KEY:-}" ]; then
    debug "skipped (env not set)"
    return 0
  fi
  command -v curl >/dev/null 2>&1 || { debug "skipped (no curl)"; return 0; }

  local input=""
  if [ ! -t 0 ]; then
    input="$(timeout 2 cat 2>/dev/null || true)"
  fi

  local repo branch
  repo="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#^(https?://[^/]+/|git@[^:]+:)##; s#\.git$##')"
  [ -n "$repo" ] || repo="derek-hobden/paper-golf"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

  local payload
  payload="$(HOOK_INPUT="$input" EVENT="$event" NOTE="$note" REPO="$repo" BRANCH="$branch" python3 - <<'PY' 2>/dev/null
import json, os
try:
    hook = json.loads(os.environ.get("HOOK_INPUT") or "{}")
    if not isinstance(hook, dict):
        hook = {}
except Exception:
    hook = {}
remote = os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID", "")
bare = remote
for p in ("cse_", "session_"):
    if bare.startswith(p):
        bare = bare[len(p):]
session_id = bare or str(hook.get("session_id") or os.environ.get("CLAUDE_CODE_SESSION_ID", ""))
session_url = ("https://claude.ai/code/session_" + bare) if bare else ""
reason = hook.get("reason") or hook.get("notification_type") or ""
note = os.environ.get("NOTE") or ""
if not note:
    msg = hook.get("message") or hook.get("last_assistant_message") or ""
    note = str(msg)[:500]
print(json.dumps({
    "session_id": session_id,
    "session_url": session_url,
    "repo": os.environ.get("REPO", ""),
    "branch": os.environ.get("BRANCH", ""),
    "hook_event": os.environ.get("EVENT", "unknown"),
    "reason": str(reason),
    "note": note,
}))
PY
)"
  [ -n "$payload" ] || { debug "skipped (payload build failed)"; return 0; }

  # Header goes through a here-string config so the key never appears in argv.
  local code
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$FACTORY_PING_KEY" | \
    curl -sS -o /dev/null -w '%{http_code}' --max-time 5 --connect-timeout 5 \
      -X POST -H 'Content-Type: application/json' -K - \
      --data-binary "$payload" "$FACTORY_PING_URL" 2>/dev/null || true)"
  debug "http ${code:-000}"
  return 0
}

main >/dev/null || true
exit 0

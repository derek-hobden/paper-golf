#!/usr/bin/env bash
# Factory session ping: tells the bot that started this Claude Code cloud session
# that the session finished, is asking a question, hit an error, or ended.
#
# Called by the hooks in .claude/settings.json:
#   scripts/factory/session-ping.sh <hook_event> [note]
# The hook JSON arrives on stdin. Payload:
#   {session_id, session_url, repo, branch, hook_event, reason, note}
# reason is always set: "error" (manual-error, StopFailure, any *error*/*fail*
# event), "question" (Notification, or a Stop whose last assistant text asks
# something; note then holds the question), "done" (other Stop),
# "ended:<reason>" (SessionEnd).
#
# Sends only from a cloud session: no CLAUDE_CODE_REMOTE_SESSION_ID means no
# ping, so a local `claude --cloud` launcher stays quiet. Also needs
# FACTORY_PING_URL and FACTORY_PING_KEY (set on the Claude cloud environment,
# never in the repo); if either is missing, or the URL is not https, it does
# nothing. Never prints the URL or the key, gives curl 5 s, and always exits 0
# so it can't hold up a session.
# FACTORY_PING_DEBUG=1 prints only "session-ping: http NNN" or "skipped (...)"
# to stderr.

event="${1:-unknown}"
note="${2:-}"

debug() { [ "${FACTORY_PING_DEBUG:-}" = "1" ] && printf 'session-ping: %s\n' "$1" >&2; return 0; }

main() {
  if [ -z "${CLAUDE_CODE_REMOTE_SESSION_ID:-}" ]; then
    debug "skipped (not a cloud session)"
    return 0
  fi
  if [ -z "${FACTORY_PING_URL:-}" ] || [ -z "${FACTORY_PING_KEY:-}" ]; then
    debug "skipped (env not set)"
    return 0
  fi
  # The key rides in a header, so the ping goes only over TLS.
  case "$FACTORY_PING_URL" in
    https://*) ;;
    *) debug "skipped (url is not https)"; return 0 ;;
  esac
  command -v curl >/dev/null 2>&1 || { debug "skipped (no curl)"; return 0; }
  command -v python3 >/dev/null 2>&1 || { debug "skipped (no python3)"; return 0; }

  local input=""
  if [ ! -t 0 ]; then
    input="$(timeout 2 cat 2>/dev/null || true)"
  fi

  local repo branch
  repo="$(git config --get remote.origin.url 2>/dev/null | sed -E 's#^(https?://[^/]+/|git@[^:]+:)##; s#\.git$##')"
  [ -n "$repo" ] || repo="derek-hobden/paper-golf"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

  local payload
  payload="$(HOOK_INPUT="$input" EVENT="$event" NOTE="$note" REPO="$repo" BRANCH="$branch" \
    timeout 3 python3 - <<'PY' 2>/dev/null
import json, os, re

def load_hook():
    try:
        h = json.loads(os.environ.get("HOOK_INPUT") or "{}")
        return h if isinstance(h, dict) else {}
    except Exception:
        return {}

def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [c.get("text", "") for c in content
                 if isinstance(c, dict) and c.get("type") == "text"]
        return "\n".join(p for p in parts if p)
    return ""

def last_assistant_text(path):
    # Last assistant text in the JSONL transcript; reads at most the final 2 MB.
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - 2_000_000))
            lines = f.read().decode("utf-8", "replace").splitlines()
    except Exception:
        return ""
    for line in reversed(lines):
        try:
            e = json.loads(line)
        except Exception:
            continue
        if not isinstance(e, dict):
            continue
        msg = e.get("message") if isinstance(e.get("message"), dict) else {}
        if e.get("type") == "assistant" or msg.get("role") == "assistant":
            t = text_of(msg.get("content", e.get("content"))).strip()
            if t:
                return t
    return ""

ASK = re.compile(
    r"\b(should i|shall i|do you want|would you like|would you prefer|can you confirm|"
    r"could you confirm|please confirm|please (?:choose|decide|advise|approve|reply|answer)|"
    r"let me know (?:if|whether|which|what|how)|which (?:option|one|approach) (?:do|would|should)|"
    r"(?:need|waiting (?:on|for)|awaiting) your (?:decision|input|answer|approval|go-ahead|call)|"
    r"before i (?:proceed|continue))\b", re.I)

def question_in(text):
    """Return the question text if the message asks something, else ''."""
    t = text.strip()
    if not t:
        return ""
    stripped = t.rstrip(" \t\n\"'*_)`")
    paras = [p.strip() for p in re.split(r"\n\s*\n", t) if p.strip()]
    if stripped.endswith("?"):
        return paras[-1] if paras else t
    # Only the closing two paragraphs count, so an early rhetorical "?" in a
    # long summary doesn't turn a finished turn into a question.
    for p in reversed(paras[-2:]):
        if ASK.search(p) or re.search(r"\?(?=[\s\"'*_)`]|$)", p):
            return p
    return ""

hook = load_hook()
event = os.environ.get("EVENT") or str(hook.get("hook_event_name") or "unknown")
note = os.environ.get("NOTE") or ""
remote = os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID", "")
bare = remote
for p in ("cse_", "session_"):
    if bare.startswith(p):
        bare = bare[len(p):]
if not bare:
    raise SystemExit(0)

ev = event.lower()
if ev == "manual-error" or ev == "stopfailure" or "error" in ev or "fail" in ev:
    reason = "error"
    if not note:
        note = str(hook.get("error") or hook.get("message") or "")
elif ev == "notification":
    reason = "question"
    if not note:
        note = str(hook.get("message") or hook.get("notification_type") or "")
elif ev == "stop":
    last = str(hook.get("last_assistant_message") or "").strip()
    if not last and hook.get("transcript_path"):
        last = last_assistant_text(str(hook["transcript_path"]))
    q = question_in(last)
    if q:
        reason = "question"
        note = note or q
    else:
        reason = "done"
        note = note or last
elif ev == "sessionend":
    reason = "ended:" + str(hook.get("reason") or "other")
else:
    reason = ev or "unknown"

print(json.dumps({
    "session_id": bare,
    "session_url": "https://claude.ai/code/session_" + bare,
    "repo": os.environ.get("REPO", ""),
    "branch": os.environ.get("BRANCH", ""),
    "hook_event": event,
    "reason": reason,
    "note": str(note)[:500],
}))
PY
)"
  [ -n "$payload" ] || { debug "skipped (no payload)"; return 0; }

  # The key goes to curl as config on stdin, so it never appears in argv. In a
  # quoted config value a backslash and a double quote are escapes, so both are
  # escaped: a key holding either would otherwise end the header early.
  local code key="${FACTORY_PING_KEY//\\/\\\\}"
  key="${key//\"/\\\"}"
  code="$(printf 'header = "Authorization: Bearer %s"\n' "$key" | \
    curl -sS -o /dev/null -w '%{http_code}' --max-time 5 --connect-timeout 5 \
      -X POST -H 'Content-Type: application/json' -K - \
      --data-binary "$payload" "$FACTORY_PING_URL" 2>/dev/null || true)"
  debug "http ${code:-000}"
  return 0
}

main >/dev/null || true
exit 0

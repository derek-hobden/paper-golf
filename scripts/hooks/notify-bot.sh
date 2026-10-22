#!/usr/bin/env bash
# Tell the owning bot, the moment it happens, that this Claude Code session has
# stopped, has something to say or has ended (Derek, 22 Oct 2026: "as soon as
# Claude code has some feedback, or a question, or it has stopped, the agent,
# the Grokbot needs to be on top of it straight away. We can not do things
# where we poll.").
#
#   echo '<hook json>' | bash scripts/hooks/notify-bot.sh
#
# Wired to the Stop, Notification and SessionEnd hooks in .claude/settings.json.
# Reads the hook's own JSON on stdin and POSTs exactly
#   {session_id, remote_session_id, branch, event, event_id, event_at,
#    cwd_repo, last_message}
# to $GROKBOT_EVENTS_URL, with the key from $GROKBOT_EVENTS_KEY sent as
# `Authorization: Bearer <key>`.
#   session_id         the session's own id, from the hook JSON
#   remote_session_id  the claude.ai session, from $CLAUDE_CODE_REMOTE_SESSION_ID
#                      ("" on a local session, which has no such id)
#   event_id           sha256 of the session, event and message: the same event
#                      posted twice carries the same id, so the receiver can
#                      drop the duplicate
#   event_at           when the hook fired, ISO-8601 UTC, for ordering
#   last_message       the last assistant message in the session transcript, cut
#                      to 1000 characters
# Those are the whole payload: besides the one session id above, no environment
# values, no file contents, no secrets, no rows. The URL and the key live in the
# environment only — neither is ever written in this repo.
#
# A hook must never block or fail a session, so every way this can go wrong
# exits 0 and says nothing: either variable unset, node or curl missing, hook
# JSON that does not parse or names no session, a POST that fails, and a POST
# still unanswered after 5 seconds.
# Bash 3.2 compatible (macOS /bin/bash). Reads only: the transcript and git.
set -uo pipefail
# Deliberately no `set -e`: this script reports a problem by posting nothing,
# never by a non-zero exit, and every step below handles its own failure.
case "${1:-}" in -h | --help) sed -n '2,33p' "$0"; exit 0 ;; esac

TIMEOUT_S=5

url="${GROKBOT_EVENTS_URL:-}"
key="${GROKBOT_EVENTS_KEY:-}"
# No endpoint or no key: there is nobody to tell.
[ -n "$url" ] && [ -n "$key" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

hook="$(cat)" || exit 0
[ -n "$hook" ] || exit 0

# The session's directory, from the hook's own JSON; a hook runs in the project
# directory, which is the fallback. Node is the only JSON parser every machine
# has (same reason as scripts/ship/pr-risk.sh).
cwd="$(HOOK_JSON="$hook" node -e '
  let hook = {};
  try { hook = JSON.parse(process.env.HOOK_JSON ?? "{}"); } catch { process.exit(1); }
  const cwd = hook !== null && typeof hook === "object" && typeof hook.cwd === "string" ? hook.cwd : "";
  process.stdout.write(cwd.replace(/[\r\n]/g, " "));
' 2>/dev/null)" || exit 0
[ -n "$cwd" ] && [ -d "$cwd" ] || cwd="$PWD"

branch="$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null)" || branch=''
top="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || top=''
[ -n "$top" ] || top="$cwd"
repo="${top##*/}"

# The payload, built where the escaping is safe. An unparsable hook JSON exits
# 1 here and so posts nothing: an event with no session on it tells the bot
# nothing it can act on.
payload="$(HOOK_JSON="$hook" HOOK_BRANCH="$branch" HOOK_REPO="$repo" node -e '
  const fs = require("node:fs");
  const { createHash } = require("node:crypto");
  let hook;
  try { hook = JSON.parse(process.env.HOOK_JSON ?? ""); } catch { process.exit(1); }
  if (hook === null || typeof hook !== "object" || Array.isArray(hook)) process.exit(1);
  const str = (v) => (typeof v === "string" ? v : "");
  // No session on it is nothing the bot can act on, so there is nothing to post.
  if (str(hook.session_id) === "") process.exit(1);

  // The last assistant message in the transcript (JSONL, one entry per line):
  // its text blocks joined, trimmed, and cut to 1000 characters.
  let last = "";
  let size = 0;
  const path = str(hook.transcript_path);
  if (path !== "") {
    let lines = [];
    try {
      const raw = fs.readFileSync(path, "utf8");
      size = raw.length;
      lines = raw.split("\n");
    } catch { lines = []; }
    for (const line of lines) {
      if (line.trim() === "") continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry === null || typeof entry !== "object" || entry.type !== "assistant") continue;
      const content = entry.message === null || typeof entry.message !== "object" ? undefined : entry.message.content;
      let text = "";
      if (typeof content === "string") text = content;
      else if (Array.isArray(content))
        text = content
          .filter((b) => b !== null && typeof b === "object" && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n");
      text = text.trim();
      if (text !== "") last = text;
    }
  }

  const session = str(hook.session_id);
  const event = str(hook.hook_event_name);
  const message = last.slice(0, 1000);
  // One id per event, not per POST: the same session, event and transcript
  // state hash the same, so a repeated delivery is a duplicate the receiver
  // can drop, and the next message is a new event.
  const id = createHash("sha256")
    .update([session, event, String(size), message].join("\n"))
    .digest("hex");

  process.stdout.write(JSON.stringify({
    session_id: session,
    remote_session_id: str(process.env.CLAUDE_CODE_REMOTE_SESSION_ID),
    branch: str(process.env.HOOK_BRANCH),
    event,
    event_id: id,
    event_at: new Date().toISOString(),
    cwd_repo: str(process.env.HOOK_REPO),
    last_message: message,
  }));
' 2>/dev/null)" || exit 0
[ -n "$payload" ] || exit 0

# The body goes through a file and the URL and key through a config file on
# stdin, so neither the key nor the message ever appears in argv, `ps` or a log
# (the same rule as ship_vercel_get in scripts/ship/lib.sh). A curl config
# string is double-quoted, so a backslash or a quote in either value is escaped.
body="$(mktemp "${TMPDIR:-/tmp}/notify-bot.XXXXXX")" || exit 0
trap 'rm -f "$body"' EXIT
printf '%s' "$payload" >"$body" || exit 0

cfg_quote() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  printf '%s' "$s"
}

# --max-time is the whole exchange: a POST that fails, or is still unanswered
# after TIMEOUT_S seconds, leaves the session alone.
{
  printf 'url = "%s"\n' "$(cfg_quote "$url")"
  printf 'header = "Authorization: Bearer %s"\n' "$(cfg_quote "$key")"
} | curl -sS -K - -X POST \
  -H 'Content-Type: application/json' \
  --data-binary "@$body" \
  --connect-timeout "$TIMEOUT_S" --max-time "$TIMEOUT_S" \
  -o /dev/null >/dev/null 2>&1

exit 0

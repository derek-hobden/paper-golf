#!/usr/bin/env bash
# One automatic retry, with a hard per-attempt timeout, for a CI step that can hang.
#
#   bash scripts/ship/retry.sh --timeout 2m [--attempts 2] -- <command> [args...]
#
# Runs the command under `timeout`; a failure or a timeout is retried once (--attempts),
# and the exit status of the last attempt is this script's. Everything this script says
# goes to stderr, so `url="$(retry.sh ... -- vercel deploy ...)"` still captures the
# command's own stdout and nothing else.
# A deploy step that hangs is what this exists for: `playwright install --with-deps`
# froze three deploy jobs for 15-20 minutes on 22 Oct 2026 (run 39781080561) because
# nothing bounded it. Paper Golf uses no tags. CLAUDE.md "Ship process".
set -uo pipefail
case "${1:-}" in -h | --help) sed -n '2,13p' "$0"; exit 0 ;; esac

per_attempt=''
attempts=2
while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) per_attempt="${2:-}"; shift 2 ;;
    --attempts) attempts="${2:-}"; shift 2 ;;
    --) shift; break ;;
    *) echo "retry.sh: unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done

[ -n "$per_attempt" ] || { echo "retry.sh: --timeout <duration> is required (see --help)" >&2; exit 2; }
case "$attempts" in '' | *[!0-9]*) echo "retry.sh: --attempts must be a number" >&2; exit 2 ;; esac
[ "$attempts" -ge 1 ] || { echo "retry.sh: --attempts must be at least 1" >&2; exit 2; }
[ $# -gt 0 ] || { echo "retry.sh: no command after -- (see --help)" >&2; exit 2; }

n=1
status=0
while :; do
  echo "→ attempt $n of $attempts (timeout $per_attempt): $*" >&2
  status=0
  # TERM first so the command can stop itself, KILL 30s later if it will not.
  timeout --kill-after=30s "$per_attempt" "$@" || status=$?
  [ "$status" = 0 ] && exit 0
  # 124 is timeout's own verdict; 137 is the KILL that followed it.
  if [ "$status" = 124 ] || [ "$status" = 137 ]; then
    echo "✗ attempt $n of $* hit the $per_attempt timeout" >&2
  else
    echo "✗ attempt $n of $* failed (exit $status)" >&2
  fi
  [ "$n" -lt "$attempts" ] || break
  n=$((n + 1))
  sleep "${RETRY_PAUSE_S:-5}"
done
echo "::error::$* failed $attempts times (last exit $status)" >&2
exit "$status"

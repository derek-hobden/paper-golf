#!/usr/bin/env bash
# PreToolUse guard: refuse a Bash `git push` whose destination is main/master
# when the command never names main: a bare `git push`, `git push origin HEAD`
# and the like, run in a checkout that is on main or whose push target is
# origin/main.
#
# The `git push * main` / `*:main` deny rules in .claude/settings.json match the
# command text, so they can't see those: they would reach main (and deploy
# staging once CI is green) without scripts/ship/push-to-main.sh. An explicit
# `git push origin HEAD:main` is left to those deny rules.
#
# Wired in .claude/settings.json as a PreToolUse hook matching Bash
# (scripts/__tests__/claude-hooks-wired.test.ts pins that). This file is a
# cheap prefilter (it runs on every Bash call); the parsing lives in
# block-push-from-main.mjs. Exit 2 blocks with the reason on stderr; anything
# it can't reason about exits 0. There is no bypass: ship with push-to-main.sh.
set -uo pipefail

payload=$(cat)

case "$payload" in
  *git*push*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

printf '%s' "$payload" | node "$(dirname "$0")/block-push-from-main.mjs"

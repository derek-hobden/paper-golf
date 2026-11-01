#!/usr/bin/env bash
# PreToolUse guard (Bash): run the pre-push secret scan before any command
# that pushes, and block the command (exit 2, reason on stderr) on a hit.
#
# Git runs husky's hooks only after `npm install` has set core.hooksPath to
# .husky/_. A fresh Claude cloud container starts with neither (no
# node_modules, no core.hooksPath), and Paper Golf's husky has no pre-push hook
# anyway, so a session could publish a secret with nothing scanning it. This
# hook runs the scan (secretProblems, scripts/claude-hooks/push-guards.mjs:
# Node builtins only, no node_modules) over origin/main..HEAD of the checkout
# the push acts on. Fleet template, from RuckBee PR 473.
#
# Wired in .claude/settings.json as a PreToolUse hook matching Bash
# (tests/claude-no-prompts.test.ts pins that; behaviour in
# tests/pre-push-scan.test.ts). This file is a cheap prefilter (it runs on every
# Bash call); the parsing and the scan live in pre-push-scan.mjs. Anything it
# cannot reason about (no node, no origin/main, not a repo) exits 0.
set -uo pipefail

payload=$(cat)

case "$payload" in
  *git*push*) ;;
  *) exit 0 ;;
esac

command -v node >/dev/null 2>&1 || exit 0

printf '%s' "$payload" | node "$(dirname "$0")/pre-push-scan.mjs"

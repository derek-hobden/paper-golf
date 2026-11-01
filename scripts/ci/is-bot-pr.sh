#!/usr/bin/env bash
# Usage: is-bot-pr.sh <author login> <head branch>
# Exit 0 when the pull request is a bot's, 1 when it is not. Prints nothing.
# A bot PR: the author is one of the configured bot logins or the head branch
# starts with one of $BOT_BRANCH_PREFIXES (space-separated). Config comes from
# the calling workflow's env block (the per-repo EDIT lines), e.g.
#   BOT_LOGINS: "your-bot-login,your-bot-login[bot]"   # EDIT
#   BOT_BRANCH_PREFIXES: "claude/"                      # EDIT
# BOT_LOGINS is comma- or space-separated; the older BOT_AUTHORS
# (space-separated) is still read and merged in. BOT_BRANCH_PREFIXES defaults
# to "claude/" only when unset (set it to "" to disable branch matching).
# Shared by every bot-ping-*.yml workflow except bot-ping-pr-closed.yml, which
# runs on pull_request_target, checks nothing out and inlines the same test.
set -f # a login like your-bot-login[bot] is not a glob
author="${1:-}"
branch="${2:-}"
logins="${BOT_LOGINS:-} ${BOT_AUTHORS:-}"
for a in ${logins//,/ }; do
  [ -n "$author" ] && [ "$author" = "$a" ] && exit 0
done
for p in ${BOT_BRANCH_PREFIXES-claude/}; do
  case "$branch" in "$p"*) exit 0 ;; esac
done
exit 1

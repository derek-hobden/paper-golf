#!/usr/bin/env bash
# Retired: nothing pushes to main any more. Every change to Paper Golf goes
# through a pull request to main, and the merge pipeline deploys it
# (CLAUDE.md "Ship process", .github/workflows/ci.yml):
#
#   1. branch, commit, `npm run check` and `npm run smoke`;
#   2. open a pull request to main: check, smoke and claude-review must pass;
#   3. risk:low merges itself, risk:high waits for Derek's approval in GitHub;
#   4. the merge deploys that sha to staging, smokes it there, promotes the same
#      sha to production and smokes it again (a red production smoke rolls
#      Vercel back to the last good deployment).
#
# This script only says so: it pushes nothing, runs no check and reads no
# remote. Branch protection on main refuses a direct push anyway.
set -euo pipefail
cat >&2 <<'MSG'
✗ scripts/ship/push-to-main.sh is retired: Paper Golf never pushes to main.
  Open a pull request to main instead, and let the pipeline deploy it:
    git push -u origin HEAD     # your branch, then open the PR (gh pr create)
  check, smoke and claude-review must pass; risk:low merges itself, risk:high
  waits for Derek's approval in GitHub. Then the merge deploys main to staging,
  smokes it, promotes the same sha to production and smokes that too.
  CLAUDE.md "Ship process".
MSG
exit 1

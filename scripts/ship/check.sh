#!/usr/bin/env bash
# Run every check CI runs before a deploy (.github/workflows/ci.yml), on this
# machine, once: the "checking" stage. The same step in breez, medifinder and
# ruckbee. Never pushes, never deploys.
#
#   bash scripts/ship/check.sh
#
# Checks: a clean worktree, then `npm run check` (typecheck, lint, vitest incl.
# the scripts/ship cases, build), then `npm run smoke` (Playwright against the
# build), then actionlint on the workflows when it is installed.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,10p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need git npm

[ -z "$(git status --porcelain)" ] ||
  ship_die "uncommitted changes: commit them first, so the checks run on the commit itself"

sha="$(git rev-parse HEAD)"
echo "→ checking ${sha:0:12}"
npm run check || ship_die "checks failed on ${sha:0:12}: npm run check"
npm run smoke || ship_die "checks failed on ${sha:0:12}: npm run smoke"
if command -v actionlint >/dev/null 2>&1; then
  actionlint || ship_die "checks failed on ${sha:0:12}: actionlint"
else
  echo "skip: actionlint not installed"
fi
[ "$(git rev-parse HEAD)" = "$sha" ] || ship_die "HEAD moved during the checks"
echo "Checks passed on ${sha:0:12}"

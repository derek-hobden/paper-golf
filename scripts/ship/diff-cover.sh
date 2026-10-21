#!/usr/bin/env bash
# Changed-line coverage for src/engine and src/game.
# At least 80% of the coverable added lines in the diff must be hit by the
# vitest v8 report (coverage/coverage-final.json, or the path in $3).
# Lines that are not statements do not count. No coverable lines is a pass.
#
#   bash scripts/ship/diff-cover.sh <base> <head> [coverage.json]
#
# Exit 0 when the gate passes, 1 when it fails, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,9p' "$0"; exit 0 ;; esac
[ $# -eq 2 ] || [ $# -eq 3 ] || { echo "usage: diff-cover.sh <base> <head> [coverage.json]" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
node --experimental-strip-types "$root/tests/diffcover.ts" "$@"

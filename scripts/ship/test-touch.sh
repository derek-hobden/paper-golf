#!/usr/bin/env bash
# Fail a pull request that changes non-test src without changing a test file.
# A test file is tests/**, e2e/** or *.test.ts.
#
#   PR_ACTOR=dependabot[bot] bash scripts/ship/test-touch.sh <base> <head>
#
# Exit 0 when the PR is exempt or tests changed with the src change.
# Exit 1 when non-test src changed and no test file did.
# Exempt: PR_ACTOR is dependabot[bot], or every changed path is docs, config
# or a workflow. Exit 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,10p' "$0"; exit 0 ;; esac
[ $# -eq 2 ] || { echo "usage: test-touch.sh <base> <head>" >&2; exit 2; }
base="$1"
head="$2"

case "${PR_ACTOR:-}" in
  'dependabot[bot]') echo "test-touch: dependabot"; exit 0 ;;
esac

files="$(git diff --name-only "$base" "$head")" || { echo "cannot read the diff $base $head" >&2; exit 1; }

exempt_only=1
src_code=0
test_file=0
any=0
while read -r f; do
  [ -n "$f" ] || continue
  any=1
  case "$f" in
    *.md | docs/* | .github/* | package.json | package-lock.json | tsconfig.json | eslint.config.js | vite.config.ts | playwright.config.ts | vercel.json | .nvmrc | .gitignore | stryker.config.json | vitest.config.ts) ;;
    *) exempt_only=0 ;;
  esac
  case "$f" in
    tests/* | e2e/* | *.test.ts) test_file=1 ;;
  esac
  case "$f" in
    src/*)
      case "$f" in
        *.test.ts) ;;
        *) src_code=1 ;;
      esac
      ;;
  esac
done <<<"$files"

if [ "$any" = 0 ] || [ "$exempt_only" = 1 ]; then
  echo "test-touch: docs, config or workflows only"
  exit 0
fi
if [ "$src_code" = 0 ]; then
  echo "test-touch: no non-test src change"
  exit 0
fi
if [ "$test_file" = 1 ]; then
  echo "test-touch: a test file changed"
  exit 0
fi
echo "src changed without a test file (tests/**, e2e/** or *.test.ts)" >&2
exit 1

#!/usr/bin/env bash
# Decide from the diff alone whether a pull request is low risk (auto-merge may
# take it) or high risk (Derek approves and merges it in GitHub): the auto-merge
# rules in AGENTS.md "Ship process". The other half of those rules — a Claude
# review with no blocking comment, and green CI — is enforced by
# .github/workflows/claude-review.yml and the required status checks.
#
#   bash scripts/ship/pr-risk.sh <base> <head>     # e.g. origin/main HEAD
#
# Prints, one per line:
#   risk=low|high
#   lines=<changed lines, excluding tests, e2e specs and lockfiles>
#   reason=<why it is high>     (one line per reason; none at all when low)
#
# High risk when the diff touches CI or deploy config (.github/, vercel.json,
# scripts/ship/, playwright.config.ts), secrets or env vars, auth or payment
# code, bumps a dependency's major version, or changes more than MAX_LINES (400)
# lines outside tests and lockfiles. Reads only: no fetch, no write, no network.
# Exits 0 on either verdict, 2 on a usage error, 1 when the diff cannot be read.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,19p' "$0"; exit 0 ;; esac
[ $# = 2 ] || { echo "usage: pr-risk.sh <base> <head> (see --help)" >&2; exit 2; }
base="$1"
head="$2"
max_lines="${MAX_LINES:-400}"
range="$base...$head"

files="$(git diff --name-only "$range")" || { echo "cannot read the diff $range" >&2; exit 1; }

reasons=''
add() { reasons="${reasons}reason=$1"$'\n'; }

while read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    .github/* | vercel.json | scripts/ship/* | playwright.config.ts)
      add "touches CI or deploy config: $f" ;;
  esac
  case "$f" in
    *.env | *.env.*) add "touches secrets or env vars: $f" ;;
  esac
  case "$f" in
    *auth* | *login* | *session* | *password* | *payment* | *billing* | *checkout* | *stripe*)
      add "touches auth or payment code: $f" ;;
  esac
done <<<"$files"

# An added line that reads a secret or an env var (docs excepted, where such a
# line is prose). Each grep reads a captured diff, never a pipe: under pipefail
# a `git diff | grep -q` match kills git with SIGPIPE and reads as a failure.
secret_re='^\+[^+].*(process\.env|secrets\.[A-Z]|[A-Z_]*(SECRET|TOKEN|PASSWORD|API_KEY))'
while read -r f; do
  [ -n "$f" ] || continue
  case "$f" in *.md) continue ;; esac
  if grep -qE "$secret_re" <<<"$(git diff "$range" -- "$f")"; then
    add "adds a secret or env var read: $f"
  fi
done <<<"$files"

# A dependency's major version changed in package.json (a minor or patch bump is
# low risk). Node is the only JSON parser every runner has.
if grep -qxF 'package.json' <<<"$files"; then
  merge_base="$(git merge-base "$base" "$head")"
  old_pkg="$(git show "$merge_base:package.json" 2>/dev/null || echo '{}')"
  new_pkg="$(git show "$head:package.json")"
  # Plain concatenation, no template literals: a `$` inside these single quotes
  # would read as a shell expansion (shellcheck SC2016).
  bumps="$(OLD_PKG="$old_pkg" NEW_PKG="$new_pkg" node -e '
    const read = (s) => { try { return JSON.parse(s); } catch { return {}; } };
    const deps = (p) => Object.assign({}, ...["dependencies", "devDependencies", "peerDependencies",
      "optionalDependencies"].map((k) => p[k] ?? {}));
    const major = (v) => String(v).replace(/^npm:.*@/, "").replace(/^[^0-9]*/, "").split(".")[0];
    const was = deps(read(process.env.OLD_PKG ?? "{}")), now = deps(read(process.env.NEW_PKG ?? "{}"));
    for (const [name, v] of Object.entries(now)) {
      if (name in was && major(was[name]) !== major(v)) console.log(name + " " + was[name] + " -> " + v);
    }
  ')"
  while read -r bump; do
    [ -n "$bump" ] || continue
    add "dependency major bump: $bump"
  done <<<"$bumps"
fi

# The size of the change, ignoring tests, e2e specs and lockfiles (a big test is
# the point of a small fix, not a risk).
lines=0
while read -r added deleted path; do
  [ -n "${path:-}" ] || continue
  case "$path" in
    tests/* | e2e/* | *.test.ts | *.spec.ts | package-lock.json | *.lock) continue ;;
  esac
  # A binary file's counts are "-": they say nothing about the diff's size.
  if [ "$added" = - ]; then added=0; fi
  if [ "$deleted" = - ]; then deleted=0; fi
  lines=$((lines + added + deleted))
done <<<"$(git diff --numstat "$range")"
[ "$lines" -le "$max_lines" ] ||
  add "over about $max_lines changed lines outside tests and lockfiles: $lines"

echo "lines=$lines"
if [ -n "$reasons" ]; then
  echo "risk=high"
  printf '%s' "$reasons"
else
  echo "risk=low"
fi

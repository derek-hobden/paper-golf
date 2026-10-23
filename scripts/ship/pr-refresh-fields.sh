#!/usr/bin/env bash
# The fields a check-refresh run needs, written to $GITHUB_OUTPUT. A refresh is a
# workflow_dispatch, so the pull_request payload is empty and the run reads the
# pull request instead. Title and body are written as multiline values and are
# never evaluated: a title is not a script.
#
#   PR=<number> bash scripts/ship/pr-refresh-fields.sh
#
# Exit 2 on a usage error, 1 when the pull request cannot be read.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,9p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: PR=<number> pr-refresh-fields.sh" >&2; exit 2; }
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
ship_need gh jq

n="${PR:-}"
[[ "$n" =~ ^[0-9]+$ ]] || { echo "PR must be a number" >&2; exit 2; }
[ -n "${GITHUB_OUTPUT:-}" ] || { echo "GITHUB_OUTPUT is required" >&2; exit 2; }

one() { gh api "/repos/$SHIP_REPO/pulls/$n" --jq "$1"; }

base="$(one '.base.sha // ""')" || { echo "cannot read pull request $n" >&2; exit 1; }
head="$(one '.head.sha // ""')"
number="$(one '.number')"
author="$(one '.user.login // ""')"
author_type="$(one '.user.type // ""')"
title="$(one '.title // ""')"
body="$(one '.body // ""')"

[[ "$base" =~ ^[0-9a-f]{40}$ ]] || { echo "pull request $n has no base sha" >&2; exit 1; }
[[ "$head" =~ ^[0-9a-f]{40}$ ]] || { echo "pull request $n has no head sha" >&2; exit 1; }

# Random, so a title that happens to contain a fixed marker cannot close the value early.
delim="FIELD$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
{
  printf 'base=%s\n' "$base"
  printf 'head=%s\n' "$head"
  printf 'number=%s\n' "$number"
  printf 'author=%s\n' "$author"
  printf 'author_type=%s\n' "$author_type"
  printf 'title<<%s\n' "$delim"
  printf '%s\n' "$title"
  printf '%s\n' "$delim"
  printf 'body<<%s\n' "$delim"
  printf '%s\n' "$body"
  printf '%s\n' "$delim"
} >>"$GITHUB_OUTPUT"
echo "refresh fields for #$number"

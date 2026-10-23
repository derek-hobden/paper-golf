#!/usr/bin/env bash
# The PR explainer-video check. An explainer video for a pull request never goes
# in the pull request: the session pushes it as one orphan commit to the
# throwaway qa-video/<branch> branch, Gus attaches it from his browser, and the
# link that attach leaves is the very first thing at the very top of the PR body
# (Derek, 23 Oct 2026). A product video anywhere else in the repo is fine — this
# is only about the PR's own video.
#
#   PR_ACTOR=<login> PR_BODY=<body> bash scripts/ship/pr-video.sh <base> <head>
#
# Fails when the diff adds a pr-explainer-* file with the extension mp4, mov,
# webm, txt or md, a root video.mp4, anything under qa-video/, or anything under
# docs/pr-videos/; or when the first non-empty line of PR_BODY is not a
# github.com/user-attachments/assets/ link.
# dependabot[bot] and renovate[bot] are exempt. Reads only: no network, no write.
# Exit 0 when the PR passes, 1 when it does not, 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,16p' "$0"; exit 0 ;; esac
[ $# -eq 2 ] || { echo "usage: pr-video.sh <base> <head> (see --help)" >&2; exit 2; }
base="$1"
head="$2"

case "${PR_ACTOR:-}" in
  'dependabot[bot]' | 'renovate[bot]')
    echo "pr-video: $PR_ACTOR is exempt"
    exit 0
    ;;
esac

# Only files the diff adds: removing an explainer that is already in the repo is
# the fix, not the offence. --no-renames so a `git mv` into a banned path is the
# add of a new path and not an R the filter drops, and -z so a non-ASCII name
# arrives raw instead of C-quoted ("qa-video/\303\251.mp4"), where the leading
# quote would stop every pattern below matching.
# The list goes through a file, not a command substitution: a NUL cannot survive
# in a shell variable.
added="$(mktemp)"
trap 'rm -f "$added"' EXIT
git diff --no-renames --diff-filter=A -z --name-only "$base" "$head" >"$added" ||
  { echo "cannot read the diff $base $head" >&2; exit 1; }

problems=''
note() { problems="${problems}  - $1"$'\n'; }

# An explainer is an explainer in any case, so match a lowercased copy and report
# the real path.
while IFS= read -r -d '' f; do
  [ -n "$f" ] || continue
  lower="$(printf '%s' "$f" | tr '[:upper:]' '[:lower:]')"
  case "$lower" in
    qa-video/*) note "$f is under qa-video/"; continue ;;
    docs/pr-videos/*) note "$f is under docs/pr-videos/"; continue ;;
    # The explainer itself, by the name the hand-over uses. It belongs on the
    # qa-video/<branch> branch and nowhere near the pull request's own tree.
    video.mp4) note "$f is the explainer video: it belongs on the qa-video/<branch> branch"; continue ;;
  esac
  case "${lower##*/}" in
    pr-explainer-*.mp4 | pr-explainer-*.mov | pr-explainer-*.webm | pr-explainer-*.txt | pr-explainer-*.md)
      note "$f is a pr-explainer-* file" ;;
  esac
done <"$added"

# The first line of the body with something on it. A GitHub body uses CRLF, so
# the trim takes \r with the spaces.
first=''
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [ -n "$line" ] || continue
  first="$line"
  break
done <<<"${PR_BODY:-}"

# The bare URL GitHub returns for Gus's attachment, on its own or in the
# markdown wrappers a body commonly puts it in.
url="$first"
wrapped='^!?\[[^][]*\]\((.*)\)$'
angled='^<(.*)>$'
if [[ "$url" =~ $wrapped ]]; then url="${BASH_REMATCH[1]}"; fi
if [[ "$url" =~ $angled ]]; then url="${BASH_REMATCH[1]}"; fi
attachment='^https://github\.com/user-attachments/assets/[A-Za-z0-9._~%-]+$'
if ! [[ "$url" =~ $attachment ]]; then
  if [ -z "$first" ]; then
    note "the PR body is empty: it must open with the video link"
  else
    note "the first non-empty line of the PR body is not a github.com/user-attachments/assets/ link: $first"
  fi
fi

if [ -z "$problems" ]; then
  echo "pr-video: ok"
  exit 0
fi

{
  echo "pr-video: this pull request does not follow the explainer-video rule."
  printf '%s' "$problems"
  echo
  echo "A PR explainer video is never committed to the pull request. After it is open:"
  echo "  1. make the Kore-narrated mp4 (H.264+AAC, under 100 MB) as video.mp4. Do not commit it here."
  echo "  2. push it as one orphan commit holding only video.mp4:"
  echo "       git switch --orphan qa-video/<branch> && git add -f video.mp4"
  echo "       git commit -m 'PR <N> explainer video' && git push -u origin qa-video/<branch>"
  echo "  3. Gus attaches it to the top of the pull request from his browser and deletes the branch."
  echo "A Claude Code cloud session cannot upload it itself — Anthropic's GitHub proxy answers 415 to a"
  echo "binary upload — so there is no gh pr edit --attach and the session never edits the body for the"
  echo "video. Gus's attach leaves the github.com/user-attachments/assets/ link as the first line of the"
  echo "PR body, the very first thing at the very top."
  echo "A product video elsewhere in the repo is fine: this rule is only about the"
  echo "explainer video for a pull request. CLAUDE.md \"PR explainer videos\"."
} >&2
exit 1

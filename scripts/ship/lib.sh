#!/usr/bin/env bash
# Shared helpers for scripts/ship/*.sh (paper-golf). Sourced, not executed.
# Needs: gh (authenticated), git, jq, curl. Read-only helpers: nothing here pushes,
# deploys or triggers a build. Bash 3.2 compatible (macOS /bin/bash).

# The GitHub repo the deploy-watch reads CI runs from.
SHIP_REPO="${SHIP_REPO:-derek-hobden/paper-golf}"
# Not secrets: the Vercel project and team ids Derek approved (14 Oct 2026).
SHIP_VERCEL_PROJECT="${SHIP_VERCEL_PROJECT:-prj_2wXuwwaoThxXs8GAfBfcreeFeWO0}"
SHIP_VERCEL_TEAM="${SHIP_VERCEL_TEAM:-team_NOIeemLqazmSprS9Y1tgjYx1}"
SHIP_VERCEL_API="${SHIP_VERCEL_API:-https://api.vercel.com}"

ship_die() {
  echo "✗ $*" >&2
  exit 1
}

ship_need() {
  local tool
  for tool in "$@"; do
    command -v "$tool" >/dev/null 2>&1 || ship_die "$tool is required"
  done
}

# The label that asks for the paid jobs again (scripts/ship/paid-trigger.sh).
SHIP_READY_LABEL="${SHIP_READY_LABEL:-ready}"

# The label an approver adds to ask the app for the Approve review main's
# branch protection wants, and the marker the app leaves on the review it
# submits, so a dismissal only ever drops its own (owner-approve.sh).
SHIP_APPROVED_LABEL="${SHIP_APPROVED_LABEL:-approved}"
SHIP_APPROVED_MARKER="${SHIP_APPROVED_MARKER:-<!-- owner-approved -->}"

# The PR video shelves: the one family of tags in this repository. Each is a
# prerelease every explainer video hangs on as an asset, made through the
# releases API by scripts/ship/pr-video-upload.sh, never triggered on and never
# a version of the game. The prefix is set here and nowhere else:
#   pr-videos             the legacy shelf, read and tidied, never uploaded to
#   pr-videos-YYYY-MM     the shelf for one UTC month
#   pr-videos-YYYY-MM-N   that month's roll, N from 2, once a shelf is full
SHIP_VIDEO_SHELF_PREFIX=pr-videos
# One shelf name, as an ERE with no anchors (bash =~, grep -E and awk alike).
SHIP_VIDEO_SHELF_RE="${SHIP_VIDEO_SHELF_PREFIX}(-[0-9][0-9][0-9][0-9]-(0[1-9]|1[0-2])(-([2-9]|[1-9][0-9]+))?)?"

# ship_video_is_shelf <tag>: is this tag one of the shelves?
ship_video_is_shelf() {
  [[ "$1" =~ ^${SHIP_VIDEO_SHELF_RE}$ ]]
}

# The shelf an upload starts from: pr-videos-YYYY-MM for the UTC month of now,
# or of SHIP_VIDEO_MONTH (YYYY-MM, a test hook) when that is set. A hook that is
# not a month is refused rather than coining a shelf from it.
ship_video_shelf_base() {
  local month
  if [ -n "${SHIP_VIDEO_MONTH+set}" ]; then
    month="$SHIP_VIDEO_MONTH"
    if ! [[ "$month" =~ ^[0-9][0-9][0-9][0-9]-(0[1-9]|1[0-2])$ ]]; then
      echo "SHIP_VIDEO_MONTH must be YYYY-MM with a month of 01 to 12, not '$month'" >&2
      return 1
    fi
  else
    month="$(date -u +%Y-%m)"
  fi
  printf '%s-%s\n' "$SHIP_VIDEO_SHELF_PREFIX" "$month"
}

# ship_video_link_re [owner/repo]: an ERE for one explainer link on any shelf
# of that repository (SHIP_REPO by default).
ship_video_link_re() {
  local repo="${1:-$SHIP_REPO}"
  printf '^https://github[.]com/%s/releases/download/%s/[A-Za-z0-9._~%%-]+[.]mp4$\n' \
    "${repo//./[.]}" "($SHIP_VIDEO_SHELF_RE)"
}

# ship_video_body_link <body>: the link a pull request body opens with, read the
# one way the check and the tidy-up both read it. The first line with something
# on it, trimmed (a GitHub body is CRLF, so \r goes with the spaces), out of the
# markdown a body commonly wraps a link in: [text](url), ![text](url), <url>.
# Prints nothing for a body with no line on it.
ship_video_body_link() {
  local line first='' wrapped='^!?\[[^][]*\]\((.*)\)$' angled='^<(.*)>$'
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    first="$line"
    break
  done <<<"${1:-}"
  if [[ "$first" =~ $wrapped ]]; then first="${BASH_REMATCH[1]}"; fi
  if [[ "$first" =~ $angled ]]; then first="${BASH_REMATCH[1]}"; fi
  printf '%s\n' "$first"
}

# ship_video_link_parts <url>: "<owner/repo> <shelf> <asset>" for an explainer
# link on any repository's shelf; non-zero for anything else.
ship_video_link_parts() {
  local re n
  re="^https://github[.]com/([A-Za-z0-9._-]+/[A-Za-z0-9._-]+)/releases/download/(${SHIP_VIDEO_SHELF_RE})/([A-Za-z0-9._~%-]+[.]mp4)$"
  [[ "$1" =~ $re ]] || return 1
  n=$((${#BASH_REMATCH[@]} - 1))
  printf '%s %s %s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[$n]}"
}

# The last time a pull request was marked ready: opened (the floor), marked
# ready for review, or given the `ready` label. Timestamps are RFC 3339 in UTC,
# so the newest is the one that sorts last. This is the clock both the merge
# gate and the explainer video count from, so neither can be made to spend
# twice for one ready mark. Needs gh.
ship_ready_mark() {
  local opened marks
  opened="$(gh api "/repos/$SHIP_REPO/pulls/$1" --jq '.created_at')" || return 1
  marks="$(gh api --paginate "/repos/$SHIP_REPO/issues/$1/timeline" --jq '
    .[] | select(.event == "ready_for_review" or (.event == "labeled" and .label.name == "'"$SHIP_READY_LABEL"'"))
    | .created_at')" || return 1
  printf '%s\n%s\n' "$opened" "$marks" | grep -v '^$' | LC_ALL=C sort | tail -n 1
}

# CI state of the newest ci.yml run for a commit:
# none | ci-running | ci-green | ci-red.
ship_ci_state() {
  local row status conclusion
  row="$(gh api "/repos/$SHIP_REPO/actions/workflows/ci.yml/runs?head_sha=$1&per_page=1" \
    --jq '.workflow_runs[0] // empty | [.status, (.conclusion // "")] | join(" ")')" || return 1
  if [ -z "$row" ]; then
    echo none
    return 0
  fi
  status="${row%% *}"
  conclusion="${row#* }"
  if [ "$status" != completed ]; then
    echo ci-running
  elif [ "$conclusion" = success ]; then
    echo ci-green
  else
    echo ci-red
  fi
}

# GET a Vercel REST path (read-only). The token goes to curl on stdin as a
# config file, so it never appears in argv, logs or `ps`. Never call this
# under `set -x`.
ship_vercel_get() {
  printf 'header = "Authorization: Bearer %s"\n' "$VERCEL_TOKEN" |
    curl -sf --max-time 20 -K - "$SHIP_VERCEL_API$1"
}

# Vercel stage for a commit, from the project's deployments of that sha:
# production-ready | production-error | production-building |
# production-skipped | preview-ready | preview-error | preview-building |
# preview-skipped | none. Production wins over preview; READY wins over
# building over error over skipped (only CANCELED, e.g. the Ignored Build Step).
ship_vercel_state() {
  local json
  json="$(ship_vercel_get "/v6/deployments?projectId=$SHIP_VERCEL_PROJECT&teamId=$SHIP_VERCEL_TEAM&sha=$1&limit=20")" ||
    return 1
  printf '%s' "$json" | jq -r --arg sha "$1" '
    [.deployments[]? | select((.meta.githubCommitSha // $sha) == $sha)
      | {target: (if .target == "production" then "production" else "preview" end),
         state: ((.state // .readyState // "") | ascii_upcase)}] as $d
    | def pick($t):
        [$d[] | select(.target == $t) | .state] as $s
        | if ($s | index("READY")) then "\($t)-ready"
          elif ($s | map(select(. == "BUILDING" or . == "QUEUED" or . == "INITIALIZING")) | length) > 0 then "\($t)-building"
          elif ($s | map(select(. != "CANCELED")) | length) > 0 then "\($t)-error"
          elif ($s | length) > 0 then "\($t)-skipped"
          else empty end;
    [pick("production"), pick("preview")] | .[0] // "none"'
}

# The project's Git link (read-only): "<org>/<repo> production-branch=<branch>",
# or "none" when the project is not linked to a Git repo.
ship_vercel_link() {
  ship_vercel_get "/v9/projects/$SHIP_VERCEL_PROJECT?teamId=$SHIP_VERCEL_TEAM" |
    jq -r 'if .link then "\(.link.org)/\(.link.repo) production-branch=\(.link.productionBranch // "?")" else "none" end'
}

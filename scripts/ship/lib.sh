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

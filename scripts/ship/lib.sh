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

# Reviews that asked for changes since the last ready mark before the automatic
# re-reviews stop and a person has to look: paid-trigger.sh stops paying at it,
# and ready-gate.sh says so. A fixed number, never read from the environment
# (exported, so shellcheck sees the scripts that source this file use it).
export SHIP_MAX_ROUNDS=3

# The label the Golf Gus Bot app puts on when a Claude review passes, and the
# one event that starts the explainer video's recording (review first, then the
# video: AGENTS.md "Paid jobs").
SHIP_REVIEW_PASSED_LABEL="${SHIP_REVIEW_PASSED_LABEL:-review-passed}"

# The explainer video is best effort and never holds a merge (Derek, 1 Nov
# 2026; AGENTS.md "PR explainer videos"): a problem with it is a warning, never
# a failure. ship_video_warning <text>: one ::warning:: line on stderr, and one
# line in the step summary under a heading that says so, written once.
SHIP_VIDEO_WARNING_TITLE='Explainer video (best effort)'
ship_video_warning() {
  local text heading='### Explainer video: best effort'
  text="$(printf '%s' "$1" | tr '\r\n' '  ' | tr -s ' ')"
  echo "::warning title=$SHIP_VIDEO_WARNING_TITLE::$text" >&2
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
  if ! grep -qxF -- "$heading" "$GITHUB_STEP_SUMMARY" 2>/dev/null; then
    printf '\n%s\n\nThe explainer video is best effort and never holds a merge: these are warnings, not failures.\n\n' \
      "$heading" >>"$GITHUB_STEP_SUMMARY"
  fi
  printf -- '- %s\n' "$text" >>"$GITHUB_STEP_SUMMARY"
}

# ship_drop_label <pr> <label>: take the label off when it is on, and fail when
# the read or the removal is refused (never hidden: a stale review-passed label
# would stand for a head nobody reviewed).
ship_drop_label() {
  local names
  names="$(gh api "/repos/$SHIP_REPO/issues/$1/labels" --jq '.[].name')" || return 1
  grep -qxF -- "$2" <<<"$names" || return 0
  gh api --method DELETE "/repos/$SHIP_REPO/issues/$1/labels/$2" >/dev/null
}

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
# markdown a body commonly wraps a link in: [text](url), ![text](url), <url>
# (never an HTML comment, which stays as written so a refusal quotes it whole).
# Prints nothing for a body with no line on it.
ship_video_body_link() {
  local line first='' wrapped='^!?\[[^][]*\]\((.*)\)$' angled='^<([^!].*)>$'
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

# --- the explainer video is tied to the head commit -------------------------
# The asset is pr-<n>-<sha7>.mp4, and that commit V is the one the video shows.
# It still stands for the head when V is the head, or when every commit on the
# first-parent path after V is one of:
#   docs only       every path it changes against its first parent, both sides
#                   of a rename, ends in .md or is under docs/ — but never
#                   AGENTS.md or CLAUDE.md (anywhere), REVIEW.md, or anything
#                   under .github/ or .claude/, which steer the agents;
#   a main update   two parents, the second an ancestor of the base branch tip,
#                   and its tree exactly the automatic merge of the two
#                   (git merge-tree --write-tree), so it brought in main and
#                   nothing else.
# Needs git with the history from V to the head and the base tip.

# ship_is_doc_path <path>: is this file docs for the rule above? Shared with
# review-state.sh, which judges the same commits through the API.
ship_is_doc_path() {
  case "$1" in
    # A file that steers an agent or the reviewer is not docs: it changes how
    # they behave (Gus, PR 61 review).
    AGENTS.md | */AGENTS.md | CLAUDE.md | */CLAUDE.md | REVIEW.md | .github/* | .claude/*) return 1 ;;
    *.md | docs/*) return 0 ;;
    *) return 1 ;;
  esac
}

# ship_docs_only_commit <commit>
ship_docs_only_commit() {
  local list f rc=0
  list="$(mktemp)"
  git diff --no-renames --name-only -z "$1^1" "$1" -- >"$list" 2>/dev/null || rc=2
  if [ "$rc" = 0 ]; then
    while IFS= read -r -d '' f; do
      ship_is_doc_path "$f" || { rc=1; break; }
    done <"$list"
  fi
  rm -f "$list"
  return "$rc"
}

# ship_clean_main_merge <commit> <base tip>
ship_clean_main_merge() {
  local parents merged tree
  local -a p
  parents="$(git rev-list --parents -n 1 "$1" 2>/dev/null)" || return 2
  read -r -a p <<<"$parents"
  [ "${#p[@]}" -eq 3 ] || return 1
  git merge-base --is-ancestor "${p[2]}" "$2" 2>/dev/null || return 1
  merged="$(git merge-tree --write-tree "${p[1]}" "${p[2]}" 2>/dev/null)" || return 1
  tree="$(git rev-parse --verify --quiet "$1^{tree}")" || return 2
  [ "${merged%%$'\n'*}" = "$tree" ]
}

# ship_video_stale <V> <head> <base tip>: why the video of V does not stand for
# the head, on stdout, or nothing when it does. Exit 0 when it stands, 1 when a
# commit needs a new video, 2 when the history cannot be read (fail closed).
ship_video_stale() {
  local v="$1" head="$2" tip="$3" list c oldest='' parent rc subject
  [ "$v" != "$head" ] || return 0
  if ! git merge-base --is-ancestor "$v" "$head" 2>/dev/null; then
    echo "the video shows ${v:0:7}, which is not in this branch's history (was the branch rewritten?)"
    return 1
  fi
  git rev-parse --verify --quiet "$tip^{commit}" >/dev/null || {
    echo "cannot read the base branch tip $tip"
    return 2
  }
  list="$(git rev-list --first-parent "$v..$head" 2>/dev/null)" || {
    echo "cannot read the history from ${v:0:7} to ${head:0:7}"
    return 2
  }
  while IFS= read -r c; do
    [ -n "$c" ] && oldest="$c"
  done <<<"$list"
  parent="$(git rev-parse --verify --quiet "$oldest^1" 2>/dev/null || true)"
  if [ -z "$oldest" ] || [ "$parent" != "$v" ]; then
    echo "the video shows ${v:0:7}, which is not on this branch's first-parent history"
    return 1
  fi
  # Oldest first, so the message names the first commit that needs the video.
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    rc=0
    ship_docs_only_commit "$c" || rc=$?
    [ "$rc" != 0 ] || continue
    [ "$rc" = 1 ] || { echo "cannot read what commit ${c:0:7} changed"; return 2; }
    rc=0
    ship_clean_main_merge "$c" "$tip" || rc=$?
    [ "$rc" != 0 ] || continue
    [ "$rc" = 1 ] || { echo "cannot read commit ${c:0:7}"; return 2; }
    subject="$(git log -1 --format=%s "$c" 2>/dev/null || true)"
    echo "commit ${c:0:7} ($subject) changed more than docs since the video's commit ${v:0:7}, and is not a clean merge of main"
    return 1
  done < <(printf '%s\n' "$list" | awk '{ a[NR] = $0 } END { for (i = NR; i > 0; i--) print a[i] }')
  return 0
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

# The bounded wait the free checks use while a paid job for the head is still
# in flight (ready-gate.sh for the Claude review, pr-video.sh for the video):
# the first poll after SHIP_WAIT_FIRST_S, then doubling to SHIP_WAIT_CAP_S, for
# SHIP_WAIT_MAX_SECONDS in all. The clock is the sum of the sleeps, and the
# sleep is SHIP_WAIT_SLEEP (a test hook; `sleep` by default), so a test never
# really waits.
SHIP_WAIT_FIRST_S="${SHIP_WAIT_FIRST_S:-15}"
SHIP_WAIT_CAP_S="${SHIP_WAIT_CAP_S:-60}"
SHIP_WAIT_MAX_SECONDS="${SHIP_WAIT_MAX_SECONDS:-600}"

# ship_wait_next <previous delay> <seconds waited so far>: the next delay, cut
# to what is left of the bound; 0 once the bound is spent. Pure.
ship_wait_next() {
  local prev="$1" waited="$2" next left
  if [ "$prev" -le 0 ]; then
    next="$SHIP_WAIT_FIRST_S"
  else
    next=$((prev * 2))
  fi
  [ "$next" -le "$SHIP_WAIT_CAP_S" ] || next="$SHIP_WAIT_CAP_S"
  left=$((SHIP_WAIT_MAX_SECONDS - waited))
  [ "$left" -gt 0 ] || left=0
  [ "$next" -le "$left" ] || next="$left"
  printf '%s\n' "$next"
}

ship_wait_sleep() {
  "${SHIP_WAIT_SLEEP:-sleep}" "$1"
}

# ship_runs_in_flight <workflow file> <head sha> [run name]: how many runs of
# that workflow for the head are queued or in progress. Without a name a run
# counts when its head_sha is the head. A workflow_run's own head is main's, not
# the pull request's (run 40490493197 reports headBranch main), so the publish
# run is matched by the name its workflow gives it instead — and that name
# carries the head sha as well as the pull request, so an older commit's run
# never counts. Needs gh.
ship_runs_in_flight() {
  local wf="$1" sha="$2" name="${3:-}" path
  # Both go into the jq below, so only the characters a sha and a name use.
  [[ "$sha" =~ ^[0-9A-Za-z]+$ ]] || return 1
  [[ "$name" =~ ^[A-Za-z0-9\ ._-]*$ ]] || return 1
  if [ -n "$name" ]; then
    path="/repos/$SHIP_REPO/actions/workflows/$wf/runs?per_page=30"
  else
    path="/repos/$SHIP_REPO/actions/workflows/$wf/runs?head_sha=$sha&per_page=30"
  fi
  gh api "$path" --jq '
    [.workflow_runs[]? | select(.status != "completed")
      | select(if "'"$name"'" == "" then .head_sha == "'"$sha"'" else .display_title == "'"$name"'" end)]
    | length'
}

# ship_video_publish_name <pull request> <head sha>: the run name
# pr-video-publish.yml gives the run that films that pull request at that head.
ship_video_publish_name() {
  printf 'PR video publish for pull request %s at %s\n' "$1" "$2"
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

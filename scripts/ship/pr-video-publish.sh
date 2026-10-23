#!/usr/bin/env bash
# Publish one pull request's explainer from the throwaway branch, without ever
# checking that branch out or running anything on it.
#
#   PR=<number> HEAD_REF=<branch> bash scripts/ship/pr-video-publish.sh
#
# With PR unset, every open same-repo pull request to main is considered (the
# schedule). The clip and narration.txt are read with git archive. A silent clip
# is narrated (pr-video-narrate.sh) and muxed (pr-video-mux.sh). A clip that
# already has audio is muxed as-is. OPENROUTER_API_KEY is unset before mux and
# before any GitHub write.
#
# The upload is POST https://uploads.github.com/user-attachments/assets. A bare
# user-attachments URL is the only form GitHub plays inline in a pull request
# body. An installation token (ghs_) is answered 404 (cli/cli#14309): the branch
# and the body are left as they are, a sticky comment records the sha, and this
# script exits 0. VIDEO_GITHUB_TOKEN is used when it is set, otherwise GH_TOKEN.
#
# The qa-video/<head> ref is deleted only after the body is patched, and only
# when the ref matches ^qa-video/[A-Za-z0-9._/-]+$ with no ".." and no "//".
# Exit 0 when every pull request was published or skipped, 1 when one failed,
# 2 on a usage error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,22p' "$0"; exit 0 ;; esac
[ $# -eq 0 ] || { echo "usage: pr-video-publish.sh (see --help)" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"
export SHIP_REPO

MAX_NARRATION=4000
STATUS_MARKER='<!-- explainer-video-status -->'
existing_id=''
recorded=0
UPLOAD_404='user-attachments uploads answer 404'
UPLOAD_URL='https://uploads.github.com/user-attachments/assets'
ASSET_RE='^https://github\.com/user-attachments/assets/[A-Za-z0-9._~%-]+$'

# qa-video/<head>. main is not a pull request head; ".." and "//" are not a ref
# this script may fetch or delete.
safe_video_ref() {
  case "$1" in
    '' | qa-video/ | qa-video/main | *..* | *'//'*) return 1 ;;
  esac
  [[ "$1" =~ ^qa-video/[A-Za-z0-9._/-]+$ ]]
}

# Drop a leading placeholder, a leading rule, and one leading attachment line,
# then put the new player above a fresh rule. The first line is the bare URL.
rewrite_body() {
  local url="$1" src="$2" dest="$3" line phase=skip rest
  rest="$(mktemp)"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [ "$phase" = skip ]; then
      case "$line" in
        '') continue ;;
        '<!-- VIDEO'*'-->') continue ;;
        ---) continue ;;
        'https://github.com/user-attachments/assets/'*) continue ;;
        '<'*'https://github.com/user-attachments/assets/'*'>') continue ;;
        '['*'https://github.com/user-attachments/assets/'*')') continue ;;
        *) phase=keep ;;
      esac
    fi
    printf '%s\n' "$line" >>"$rest"
  done <<<"$src"
  {
    printf '%s\n\n---\n\n' "$url"
    cat "$rest"
  } >"$dest"
  rm -f "$rest"
}

status_comments() {
  gh api --paginate "repos/$SHIP_REPO/issues/$1/comments" \
    --jq '.[] | select(.body | contains("<!-- explainer-video-status -->")) | [.id, (.body | gsub("\n"; " "))] | @tsv'
}

# 0 when a status comment already names this sha and the 404, and sets the
# existing comment id (empty when the pull request has none).
read_status() {
  local number="$1" sha="$2" comments id body
  existing_id=''
  recorded=0
  comments="$(status_comments "$number")" || return 1
  while IFS="$(printf '\t')" read -r id body; do
    [ -n "$id" ] || continue
    if [ -z "$existing_id" ]; then
      existing_id="$id"
    fi
    case "$body" in
      *"$sha"*)
        case "$body" in
          *"$UPLOAD_404"*) recorded=1 ;;
        esac
        ;;
    esac
  done <<<"$comments"
}

record_404() {
  local number="$1" sha="$2" qref="$3" body_file
  body_file="$(mktemp)"
  # env.BODY, not a $ in the jq program: shellcheck SC2016.
  BODY="$(printf '%s\n' \
    "The explainer at $sha is on $qref." \
    "$UPLOAD_404." \
    "An installation token cannot create that attachment (https://github.com/cli/cli/issues/14309)." \
    "Set VIDEO_GITHUB_TOKEN to a token the upload endpoint accepts and the next run will publish it. The branch was left in place." \
    "" \
    "$STATUS_MARKER")"
  BODY="$BODY" jq -n '{body: env.BODY}' >"$body_file" || return 1
  if [ -n "$existing_id" ]; then
    gh api --method PATCH --input "$body_file" "repos/$SHIP_REPO/issues/comments/$existing_id" || return 1
  else
    gh api --method POST --input "$body_file" "repos/$SHIP_REPO/issues/$number/comments" || return 1
  fi
  rm -f "$body_file"
}

upload_clip() {
  local file="$1" token repo_id status body url
  token="${VIDEO_GITHUB_TOKEN:-${GH_TOKEN:-}}"
  [ -n "$token" ] || { echo "no upload token" >&2; return 1; }
  repo_id="$(gh api "repos/$SHIP_REPO" --jq '.id')" || return 1
  [ -n "$repo_id" ] || { echo "no repository id" >&2; return 1; }
  body="$(mktemp)"
  status="$(printf 'header = "Authorization: token %s"\nheader = "Content-Type: application/octet-stream"\nurl = "%s?name=explainer.mp4&content_type=video/mp4&repository_id=%s"\nupload-file = "%s"\noutput = "%s"\nwrite-out = "%%{http_code}"\n' \
    "$token" "$UPLOAD_URL" "$repo_id" "$file" "$body" |
    curl -sS --max-time 180 -K -)" || status=''
  case "$status" in
    200 | 201) ;;
    404)
      rm -f "$body"
      return 2
      ;;
    *)
      echo "upload answered ${status:-no status}: $(head -c 200 "$body")" >&2
      rm -f "$body"
      return 1
      ;;
  esac
  url="$(jq -r '.url // empty' "$body")" || url=''
  rm -f "$body"
  if ! [[ "$url" =~ $ASSET_RE ]]; then
    echo "upload answered no attachment url" >&2
    return 1
  fi
  printf '%s\n' "$url"
}

# Copy narration.txt and the one root mp4 into $1. VIDEO_DIR is the test double;
# otherwise the files come from git archive of the fetched ref (no checkout).
load_clip() {
  local dest="$1" src count=0 mp4="" f name found=0
  mkdir -p "$dest" || return 1
  if [ -n "${VIDEO_DIR:-}" ]; then
    src="$VIDEO_DIR"
    for f in "$src"/*.mp4; do
      [ -f "$f" ] || continue
      count=$((count + 1))
      mp4="$f"
    done
    [ "$count" = 1 ] || { echo "expected one mp4 at the top of the explainer, found $count" >&2; return 1; }
    [ -f "$src/narration.txt" ] || { echo "no narration.txt" >&2; return 1; }
    cp "$mp4" "$dest/clip.mp4" || return 1
    cp "$src/narration.txt" "$dest/narration.txt" || return 1
    return 0
  fi
  git -c core.hooksPath=/dev/null fetch --no-tags origin \
    "refs/heads/${qref}:refs/pg-explainer/${qref}" || { echo "cannot fetch $qref" >&2; return 1; }
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    case "$name" in
      *.mp4) count=$((count + 1)); mp4="$name" ;;
    esac
    [ "$name" = narration.txt ] && found=1
  done <<<"$(git ls-tree --name-only "refs/pg-explainer/${qref}")"
  [ "$count" = 1 ] || { echo "expected one mp4 at the top of the explainer, found $count" >&2; return 1; }
  [ "$found" = 1 ] || { echo "no narration.txt" >&2; return 1; }
  git archive "refs/pg-explainer/${qref}" -- narration.txt "$mp4" | tar -x -C "$dest" || return 1
  if [ "$mp4" != clip.mp4 ]; then
    mv "$dest/$mp4" "$dest/clip.mp4"
  fi
}

publish_one() {
  local number="$1" head_ref="$2" actor="$3" qref sha work kind bytes url body_file raw
  case "$actor" in
    'dependabot[bot]' | 'renovate[bot]')
      echo "skip actor $actor"
      return 0
      ;;
  esac
  qref="qa-video/$head_ref"
  safe_video_ref "$qref" || { echo "refused ref $qref" >&2; return 1; }
  if [ -n "${HEAD_REPO:-}" ] && [ "$HEAD_REPO" != "$SHIP_REPO" ]; then
    echo "skip fork $HEAD_REPO"
    return 0
  fi

  if [ -n "${VIDEO_SHA:-}" ]; then
    sha="$VIDEO_SHA"
  else
    sha="$(git ls-remote origin "refs/heads/$qref" | awk '{print $1; exit}')"
    if [ -z "$sha" ]; then
      echo "no $qref"
      return 0
    fi
  fi

  read_status "$number" "$sha" || return 1
  if [ "$recorded" = 1 ]; then
    echo "already recorded $sha"
    return 0
  fi

  work="$(mktemp -d)"
  trap 'rm -rf "$work"' RETURN
  # A plain call, not `|| return`: that would turn set -e off for the whole load.
  load_clip "$work"
  ship_need ffmpeg ffprobe
  kind="$(bash "$here/pr-video-mux.sh" --probe "$work/clip.mp4")" || return 1
  case "$kind" in
    audio | silent) ;;
    *) echo "bad probe: $kind" >&2; return 1 ;;
  esac
  if [ "$kind" = silent ]; then
    bytes="$(wc -c <"$work/narration.txt" | tr -d ' ')"
    if [ "$bytes" -gt "$MAX_NARRATION" ]; then
      echo "narration is $bytes bytes; the cap is $MAX_NARRATION" >&2
      return 1
    fi
    bash "$here/pr-video-narrate.sh" "$work/narration.txt" "$work/narration.wav" || return 1
  else
    : >"$work/narration.wav"
  fi
  # Drop the speech key before mux and before any GitHub write.
  unset OPENROUTER_API_KEY
  bash "$here/pr-video-mux.sh" "$work/clip.mp4" "$work/narration.wav" "$work/out.mp4" || return 1

  set +e
  url="$(upload_clip "$work/out.mp4")"
  status=$?
  set -e
  if [ "$status" = 2 ]; then
    echo "publish=404"
    record_404 "$number" "$sha" "$qref" || return 1
    return 0
  fi
  [ "$status" = 0 ] || return 1

  body_file="$(mktemp)"
  raw="$(gh api "repos/$SHIP_REPO/pulls/$number" --jq '.body // ""')" || return 1
  rewrite_body "$url" "$raw" "$body_file"
  # The patch body is the file itself: {body: ...} is what the pulls API takes,
  # and rewrite_body wrote the markdown. Wrap it.
  BODY="$(cat "$body_file")"
  BODY="$BODY" jq -n '{body: env.BODY}' >"$body_file"
  gh api --method PATCH --input "$body_file" "repos/$SHIP_REPO/pulls/$number" || return 1
  rm -f "$body_file"
  gh api --method DELETE "repos/$SHIP_REPO/git/refs/heads/$qref" || return 1
  echo "publish=ok $url"
}

if [ -n "${PR:-}" ]; then
  [[ "$PR" =~ ^[0-9]+$ ]] || { echo "PR must be a number" >&2; exit 2; }
  [ -n "${HEAD_REF:-}" ] || { echo "HEAD_REF is required" >&2; exit 2; }
fi
ship_need gh jq curl

# The subshell is what keeps set -e on inside publish_one. Calling it from `if`
# or `||` would turn set -e off for the whole function, including the subshell.
run_one() { (set -e; publish_one "$@"); }

if [ -n "${PR:-}" ]; then
  set +e
  run_one "$PR" "$HEAD_REF" "${PR_ACTOR:-}"
  run_status=$?
  set -e
  if [ "$run_status" != 0 ]; then
    echo "explainer: failed" >&2
    exit 1
  fi
  echo "explainer: ok"
  exit 0
fi

failures=0
list="$(mktemp)"
gh api --paginate "/repos/$SHIP_REPO/pulls?state=open&base=main&per_page=100" \
  --jq '.[] | objects | select((.head.repo.full_name // "") == env.SHIP_REPO) | [(.number|tostring), .head.ref, (.user.login // "")] | @tsv' \
  >"$list" || { rm -f "$list"; echo "cannot list pull requests" >&2; exit 1; }
while IFS="$(printf '\t')" read -r number ref actor; do
  [ -n "${number:-}" ] || continue
  set +e
  run_one "$number" "$ref" "$actor"
  run_status=$?
  set -e
  if [ "$run_status" != 0 ]; then
    failures=$((failures + 1))
  fi
done <"$list"
rm -f "$list"
if [ "$failures" -gt 0 ]; then
  echo "explainer: $failures pull request(s) failed" >&2
  exit 1
fi
echo "explainer: ok"

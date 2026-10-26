#!/usr/bin/env bash
# Turn job 1's silent recording into the narrated explainer, host it as an asset
# on the month's PR video shelf (a `pr-videos-YYYY-MM` prerelease,
# pr-video-upload.sh), and put its link at the top of the pull request.
#
# This is the publish workflow's half, in two modes run by two jobs with the
# audio gate's job between them (.github/workflows/pr-video-publish.yml). It
# never checks out or runs a line of the pull request: the recording arrives
# as a workflow artifact and is treated as data throughout — ffmpeg and
# ffprobe see it with every key unset, and which pull request it belongs to is
# confirmed against the API rather than believed (AGENTS.md "PR explainer
# videos").
#
#   GH_TOKEN=<read-only token> SHIP_REPO=<owner/repo> RUN_HEAD_SHA=<sha> \
#   ANTHROPIC_API_KEY=... OPENROUTER_API_KEY=... \
#     bash scripts/ship/pr-video-publish.sh <artifact-dir>
#   GH_TOKEN=<Golf Gus app token> SHIP_REPO=<owner/repo> RUN_HEAD_SHA=<sha> \
#     bash scripts/ship/pr-video-publish.sh --upload <made-dir>
#
# The first makes the video: it confirms the pull request, drops a recording
# whose ready mark already has a video, writes and voices the narration and
# muxes it, and leaves video.mp4, narration.txt, narration.wav, model.log and
# made.json in the work directory ($VIDEO_WORK, else <artifact-dir>/work),
# with `made=true` or `made=false` on $GITHUB_OUTPUT. It holds the two keys and
# reads with a read-only token. pr-video-audio-gate.sh then listens to it in a
# job of its own with no secret. --upload is the only step that writes: it
# refuses unless <made-dir>/audio-gate.txt is that gate's PASS, then hosts the
# mp4, puts its link at the top of the body and comments, on the app's token.
#
# RUN_HEAD_SHA is the commit the triggering run recorded, from the workflow_run
# event — not from the artifact, which the pull request's own code wrote.
#
# Exit 0 when the video is made (or not needed), or the link is on the pull
# request; 1 on any failure (there is no half-published video); 2 on a usage
# error.
set -euo pipefail
case "${1:-}" in -h | --help) sed -n '2,36p' "$0"; exit 0 ;; esac
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/ship/lib.sh
. "$here/lib.sh"

# Says on $GITHUB_OUTPUT whether a video was made for the gate and the upload.
made_output() {
  [ -z "${GITHUB_OUTPUT:-}" ] || echo "made=$1" >>"$GITHUB_OUTPUT"
}

# --- hosted, linked, announced (after the gate) ------------------------------
upload_mode() {
  local made="$1" pr sha marked summary url note
  [ -d "$made" ] || { echo "::error::no made directory at $made" >&2; exit 2; }
  ship_need gh jq
  [ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }
  [ -n "${RUN_HEAD_SHA:-}" ] || { echo "::error::RUN_HEAD_SHA is not set" >&2; exit 2; }
  # Nothing is hosted that the gate did not pass, whatever the workflow says.
  if [ "$(head -n 1 "$made/audio-gate.txt" 2>/dev/null || true)" != "audio-gate: PASS" ]; then
    echo "::error::the audio gate did not pass this video, so it is not published" >&2
    exit 1
  fi
  pr="$(jq -r '.pr // empty' "$made/made.json" 2>/dev/null || true)"
  sha="$(jq -r '.sha // empty' "$made/made.json" 2>/dev/null || true)"
  marked="$(jq -r '.marked // empty' "$made/made.json" 2>/dev/null || true)"
  summary="$(jq -r '.summary // empty' "$made/made.json" 2>/dev/null || true)"
  case "$pr" in '' | *[!0-9]*) echo "::error::the made video names no pull request" >&2; exit 1 ;; esac
  [ "$sha" = "$RUN_HEAD_SHA" ] || {
    echo "::error::the made video says it shows $sha, but the run recorded $RUN_HEAD_SHA" >&2
    exit 1
  }
  [ -f "$made/video.mp4" ] || { echo "::error::no video at $made/video.mp4" >&2; exit 1; }

  url="$(PR="$pr" HEAD_SHA="$sha" bash "$here/pr-video-upload.sh" "$made/video.mp4")" || exit 1
  PR="$pr" bash "$here/pr-video-body.sh" "$url"

  # The comment is also the record of what has been bought: the marker and the
  # ready mark it was bought for are what the cap reads next time.
  note="$(mktemp)"
  trap 'rm -f "$note"' EXIT
  BODY="$(printf '%s\n\n%s\n\n    ffprobe: %s\n\n%s\nready-mark: %s\n' \
    "The explainer video for this pull request is linked at the top of the description." \
    "It was recorded and narrated by CI; nobody attached it by hand. Mark the pull request ready again, or add the \`$SHIP_READY_LABEL\` label, to have it remade." \
    "$summary" "$VIDEO_MARKER" "$marked")" jq -n '{body: env.BODY}' >"$note"
  gh api --method POST "/repos/$SHIP_REPO/issues/$pr/comments" --input "$note" >/dev/null ||
    echo "::warning::could not comment on pull request $pr; the video is still on the body" >&2

  echo "pr-video-publish: $url"
  exit 0
}

VIDEO_MARKER='<!-- pr-video-published -->'
if [ "${1:-}" = --upload ]; then
  [ $# -eq 2 ] || { echo "usage: pr-video-publish.sh --upload <made-dir> (see --help)" >&2; exit 2; }
  upload_mode "$2"
fi

[ $# -eq 1 ] || { echo "usage: pr-video-publish.sh <artifact-dir> (see --help)" >&2; exit 2; }
art="$1"
[ -d "$art" ] || { echo "::error::no artifact directory at $art" >&2; exit 2; }
ship_need gh jq
[ -n "${GH_TOKEN:-}" ] || { echo "::error::GH_TOKEN is not set" >&2; exit 2; }
[ -n "${RUN_HEAD_SHA:-}" ] || { echo "::error::RUN_HEAD_SHA is not set" >&2; exit 2; }

work="${VIDEO_WORK:-$art/work}"
mkdir -p "$work"

# --- which pull request, confirmed ------------------------------------------
# The artifact says which; the API decides whether to believe it.
pr="$(jq -r '.pr // empty' "$art/meta.json" 2>/dev/null || true)"
sha="$(jq -r '.sha // empty' "$art/meta.json" 2>/dev/null || true)"
case "$pr" in '' | *[!0-9]*) echo "::error::the artifact names no pull request" >&2; exit 1 ;; esac
[ "$sha" = "$RUN_HEAD_SHA" ] || {
  echo "::error::the artifact says it recorded $sha, but the run recorded $RUN_HEAD_SHA" >&2
  exit 1
}

row="$(gh api "/repos/$SHIP_REPO/pulls/$pr" \
  --jq '[(.head.repo.full_name // ""), (.draft|tostring), .state, "\(.changed_files) files, +\(.additions) −\(.deletions)"] | @tsv')" || {
  echo "::error::could not read pull request $pr" >&2
  exit 1
}
IFS=$'\t' read -r head_repo draft state diffstat <<<"$row"
[ "$head_repo" = "$SHIP_REPO" ] || { echo "::error::pull request $pr is from $head_repo, not $SHIP_REPO" >&2; exit 1; }
[ "$state" = open ] || { echo "::error::pull request $pr is $state" >&2; exit 1; }
[ "$draft" != true ] || { echo "::error::pull request $pr is a draft" >&2; exit 1; }
gh api --paginate "/repos/$SHIP_REPO/pulls/$pr/commits" --jq '.[].sha' | grep -qxF "$RUN_HEAD_SHA" || {
  echo "::error::$RUN_HEAD_SHA is not a commit of pull request $pr" >&2
  exit 1
}
title="$(gh api "/repos/$SHIP_REPO/pulls/$pr" --jq '.title')"
gh api "/repos/$SHIP_REPO/pulls/$pr" --jq '.body // ""' >"$work/body.md"

# One video per ready mark, decided here and nowhere else. Job 1 runs on a
# `pull_request` event, so its copy of the workflow and of paid-trigger.sh is
# the pull request's own: a branch can edit either and record whenever it likes.
# This file is main's, it cannot be edited by the pull request, and it is where
# the money is spent — so this is where the cap has to be. A recording for a
# ready mark that already has a video is dropped before anything is bought.
marked="$(ship_ready_mark "$pr")" || {
  echo "::error::could not read when pull request $pr was last marked ready" >&2
  exit 1
}
published="$(gh api --paginate "/repos/$SHIP_REPO/issues/$pr/comments" --jq '
  .[] | select(.body | contains("'"$VIDEO_MARKER"'")) | .body' |
  sed -n 's/^ready-mark: //p' | LC_ALL=C sort | tail -n 1)" || published=''
if [ -n "$published" ] && ! [[ "$published" < "$marked" ]]; then
  echo "pr-video-publish: pull request $pr already has a video for the ready mark $marked; nothing to buy"
  made_output false
  exit 0
fi

clips=()
while IFS= read -r clip; do
  [ -n "$clip" ] || continue
  clips+=("$clip")
done < <(find "$art/clips" -name '*.webm' -type f 2>/dev/null | LC_ALL=C sort)
[ "${#clips[@]}" -gt 0 ] || { echo "::error::the artifact holds no recording" >&2; exit 1; }

# --- the narrated video ------------------------------------------------------
# The picture first, so the narration can be written to fit it: a script longer
# than the walkthrough leaves the video frozen on its last frame.
bash "$here/pr-video-join.sh" "$work/clip.mp4" "${clips[@]}"
seconds="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$work/clip.mp4" || true)"
# Its stdout, the model's one log line included, is kept for the debug artifact.
PR_TITLE="$title" PR_BODY="$(cat "$work/body.md")" DIFFSTAT="$diffstat" CLIP_SECONDS="$seconds" \
  bash "$here/pr-video-script.sh" "$work/narration.txt" | tee "$work/model.log"
bash "$here/pr-video-narrate.sh" "$work/narration.txt" "$work/narration.wav"
bash "$here/pr-video-mux.sh" "$work/clip.mp4" "$work/narration.wav" "$work/video.mp4"

# Listened to next, in a job of its own with no secret, before anything is
# hosted (pr-video-audio-gate.sh): the audio fills the picture, the voice is
# heard over the narration's length at a sane loudness, and it says the script.
probe="$(ffprobe -v error -show_entries stream=codec_type,codec_name \
  -show_entries format=duration,size -of default=nw=1:nk=0 "$work/video.mp4")" || {
  echo "::error::ffprobe could not read the finished video" >&2
  exit 1
}
summary="$(printf '%s\n' "$probe" | awk -F= '
  $1 == "codec_name" { codec[++n] = $2 }
  $1 == "codec_type" { kind[n] = $2 }
  $1 == "duration" { d = $2 }
  $1 == "size" { s = $2 }
  END {
    for (i = 1; i <= n; i++) printf "%s=%s ", kind[i], codec[i]
    printf "duration=%.1fs size=%d bytes", d, s
  }')"
echo "ffprobe: $summary"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  printf '### Explainer video\n\n    ffprobe: %s\n' "$summary" >>"$GITHUB_STEP_SUMMARY"
fi

# What the gate and the upload need: the pull request, the commit, the ready
# mark this video is bought for, and the summary the comment quotes.
jq -n --argjson pr "$pr" --arg sha "$sha" --arg marked "$marked" --arg summary "$summary" \
  '{pr: $pr, sha: $sha, marked: $marked, summary: $summary}' >"$work/made.json"
made_output true
echo "pr-video-publish: made the video for pull request $pr at $sha; the audio gate is next"
